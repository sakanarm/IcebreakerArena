/**
 * Bot players for load tests and demos.
 *
 *   npm run bots -- <PIN> [count=50] [--url=http://localhost:4000] [--ramp=20]
 *
 * Behind a reverse proxy, pass the app's address: --url=https://example.com/icebreaker
 *
 * Each bot joins with a random nickname, answers every question at a random
 * moment within the time limit, and records how long the server took to
 * acknowledge each answer. Gate 1 needs p95 ≤ 300 ms with 300 bots.
 */
import { io, type Socket } from 'socket.io-client';
import {
  AVATARS,
  GAME_SERVER_PORT,
  randomNickname,
  type ClientToServerEvents,
  type PlayerState,
  type ServerToClientEvents,
} from '@icebreaker/shared';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const [pin, countArg] = args.filter((a) => !a.startsWith('--'));
if (!pin) {
  console.error('usage: npm run bots -- <PIN> [count=50] [--url=http://localhost:4000] [--ramp=20]');
  process.exit(1);
}
const count = Number(countArg ?? 50);
const url = new URL(flag('url') ?? `http://localhost:${GAME_SERVER_PORT}`);
// a path in --url is where a proxy mounts the server, not a Socket.IO namespace
const socketPath = `${url.pathname.replace(/\/+$/, '')}/socket.io`;
/** bots joining per second, so the lobby fills up like a real room */
const ramp = Number(flag('ramp') ?? 20);

type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ackMs: number[] = [];
const errors = new Map<string, number>();
let joined = 0;
let finished = 0;

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function stats() {
  const sorted = [...ackMs].sort((a, b) => a - b);
  const errs = [...errors].map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  return `joined ${joined}/${count} · answers ${sorted.length} · ack p50 ${percentile(sorted, 50)} ms · p95 ${percentile(sorted, 95)} ms · max ${sorted.at(-1) ?? 0} ms · errors ${errs}`;
}

function startBot(i: number) {
  const socket: BotSocket = io(url.origin, { path: socketPath, transports: ['websocket'], forceNew: true, reconnection: true });
  let offset = 0;
  let answeredQuestion = '';

  socket.on('connect', async () => {
    const t0 = Date.now();
    const serverNow = await socket.timeout(5000).emitWithAck('time:sync').catch(() => Date.now());
    offset = serverNow - (t0 + Date.now()) / 2;
    const res = await socket
      .timeout(10_000)
      .emitWithAck('player:join', {
        pin,
        nickname: `🤖 ${randomNickname()}`.slice(0, 24),
        avatar: AVATARS[i % AVATARS.length]!,
      })
      .catch(() => ({ ok: false as const, error: 'timeout' }));
    if (res.ok) joined++;
    else errors.set(`join:${res.error}`, (errors.get(`join:${res.error}`) ?? 0) + 1);
  });

  socket.on('player:state', (s: PlayerState) => {
    if (s.phase === 'podium') {
      finished++;
      socket.close();
      return;
    }
    const q = s.question;
    if (s.phase !== 'question' || !q || s.myAnswer !== null || answeredQuestion === q.id) return;
    answeredQuestion = q.id;
    // answer somewhere between 0.3 s and 80% of the time limit after answering opens
    const at = q.startsAt + 300 + Math.random() * q.timeLimitS * 800;
    setTimeout(async () => {
      const sent = Date.now();
      const r = await socket
        .timeout(5000)
        .emitWithAck('player:answer', { questionId: q.id, choice: Math.floor(Math.random() * q.options.length) })
        .catch(() => ({ ok: false as const, error: 'timeout' }));
      if (r.ok) ackMs.push(Date.now() - sent);
      else errors.set(`answer:${r.error}`, (errors.get(`answer:${r.error}`) ?? 0) + 1);
    }, Math.max(0, at - (Date.now() + offset)));
  });

  socket.on('player:kicked', () => socket.close());
  socket.on('room:closed', () => socket.close());
  return socket;
}

console.log(`Starting ${count} bots for room ${pin} on ${url.origin}${socketPath} (${ramp}/s)`);
const sockets: BotSocket[] = [];
for (let i = 0; i < count; i++) setTimeout(() => sockets.push(startBot(i)), (i / ramp) * 1000);

const ticker = setInterval(() => {
  console.log(stats());
  if (finished >= joined && joined > 0 && finished > 0) {
    clearInterval(ticker);
    console.log(`Game over for all bots.\n${stats()}`);
    process.exit(0);
  }
}, 5000);

process.on('SIGINT', () => {
  console.log(`\n${stats()}`);
  for (const s of sockets) s.close();
  process.exit(0);
});
