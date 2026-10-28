import { isIP } from 'node:net';

/**
 * Lookups that found nothing (a PIN with no room behind it, a token that does not match), counted per client
 * address. Past `burst` of them the address is refused lookups until its count drains at `perSecond`: a PIN typed
 * wrong costs one, while guessing PINs from one address slows down to `perSecond`. Only misses count, so a whole
 * office behind one address still gets into the right PIN.
 */
export class MissLimiter {
  private counts = new Map<string, { n: number; at: number }>();

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {}

  /** whether this address may look anything up now */
  allows(address: string, now = Date.now()): boolean {
    return this.count(address, now) < this.burst;
  }

  miss(address: string, now = Date.now()) {
    this.counts.set(address, { n: this.count(address, now) + 1, at: now });
  }

  /** forgets the addresses whose count has drained; the game server runs it every minute */
  sweep(now = Date.now()) {
    for (const [address] of this.counts) if (this.count(address, now) === 0) this.counts.delete(address);
  }

  get size() {
    return this.counts.size;
  }

  private count(address: string, now: number): number {
    const c = this.counts.get(address);
    return c ? Math.max(0, c.n - ((now - c.at) / 1000) * this.perSecond) : 0;
  }
}

/**
 * Whom a connection's lookups count against. Behind the reverse proxy every connection comes from loopback and the
 * proxy names the client in X-Real-IP (deploy/nginx-icebreaker.conf sets it over whatever the client sent), or as the
 * last X-Forwarded-For entry; a client that connects straight in (a phone on the Wi-Fi of a laptop running the game)
 * is its own address, whatever headers it sends. IPv6 counts per /64, as one machine can hold all of one.
 */
export function clientAddress(peer: string, headers: Record<string, string | string[] | undefined>): string {
  const direct = plain(peer);
  if (!isLoopback(direct)) return grouped(direct);
  const real = plain(first(headers['x-real-ip']));
  if (isIP(real)) return grouped(real);
  const forwarded = plain(first(headers['x-forwarded-for']).split(',').pop() ?? '');
  return grouped(isIP(forwarded) ? forwarded : direct);
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/** an IPv4 address the way an IPv6 socket reports it (::ffff:10.1.2.3) is that IPv4 address */
const plain = (address: string) => address.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

const isLoopback = (address: string) => address === '::1' || address.startsWith('127.');

function grouped(address: string): string {
  if (isIP(address) !== 6) return address;
  // '::' stands for the zero groups left out, a dotted IPv4 tail for the last two; a zone (%eth0) names no one
  const parts = (s?: string) => (s ? s.replace(/(\d+\.){3}\d+$/, '0:0').split(':') : []);
  const [head, tail] = address.toLowerCase().replace(/%.*$/, '').split('::');
  const front = parts(head);
  const back = parts(tail);
  const groups = tail === undefined ? front : [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
