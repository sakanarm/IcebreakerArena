/**
 * How much one person may hand the knowledge base. Learning a document costs Pika real work (and,
 * behind it, model calls), so an hour holds a fair number of documents and never an endless stream.
 *
 * Counted in memory: pm2 runs the web app as one process (ecosystem.config.cjs), and a restart that
 * forgets the count forgets at most an hour of it.
 */
import { HttpError } from './http';

export const INGEST_PER_HOUR = 20;
/** two at once: a second tab is fine, a script firing twenty in parallel is not */
export const INGEST_AT_ONCE = 2;
const HOUR = 60 * 60 * 1000;

const recent = new Map<string, number[]>();
const running = new Map<string, number>();

/**
 * Holds one of the person's slots for the length of `fn`. A refused document never counts toward
 * the hour, so a file Pika could not read can be fixed and sent again.
 */
export async function withIngestSlot<T>(userId: string, fn: () => Promise<T>, now = Date.now()): Promise<T> {
  const times = (recent.get(userId) ?? []).filter((t) => now - t < HOUR);
  if (times.length >= INGEST_PER_HOUR) {
    const retryAfter = Math.ceil((times[0] + HOUR - now) / 1000);
    throw new HttpError(429, 'ingest_quota', { retryAfter, perHour: INGEST_PER_HOUR });
  }
  if ((running.get(userId) ?? 0) >= INGEST_AT_ONCE) throw new HttpError(429, 'ingest_busy');

  running.set(userId, (running.get(userId) ?? 0) + 1);
  try {
    const out = await fn();
    times.push(now);
    recent.set(userId, times);
    return out;
  } finally {
    const left = (running.get(userId) ?? 1) - 1;
    if (left > 0) running.set(userId, left);
    else running.delete(userId);
    if (!recent.get(userId)?.length) recent.delete(userId);
  }
}

/** for tests */
export function resetIngestLimits() {
  recent.clear();
  running.clear();
}

/** The extension, lowercased, when it is one Pika reads; null otherwise. */
export function ingestType(name: string, allowed: readonly string[]): string | null {
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name.trim());
  const ext = m ? m[0].toLowerCase() : '';
  return allowed.includes(ext) ? ext : null;
}

/** A file name as Pika will see it: no path, no control characters, not absurdly long. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 120) return clean;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(clean)?.[0] ?? '';
  return clean.slice(0, 120 - ext.length) + ext;
}

/** An Idempotency-Key from the browser: one per pick of a file, so a retried send is learned once. */
export function idempotencyKeyOf(v: unknown, userId: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) throw new HttpError(400, 'bad_request');
  // scoped to the person, so nobody can replay another's key into a project they do not own
  return `ib-${userId.slice(0, 40)}-${s}`.slice(0, 120);
}
