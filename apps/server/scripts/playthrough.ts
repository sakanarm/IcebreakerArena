/**
 * A built-in game played to the podium, and the host's report checked against what the bots meant to answer.
 *
 *   npm run playthrough -- [tpl-pika] [--players=6] [--url=http://localhost:4000]
 *
 * `crowd.ts` writes its own game and measures a room under load; this one plays a game we ship, so a new
 * sample is proven playable: every question is served, every type can be answered, and the report scores
 * the answers the way the game says it should. Answers go in as soon as the lead-in ends, and the host
 * closes each question the moment everyone has answered, so a 12-question game takes well under a minute.
 */
import {
  SAMPLE_GAMES,
  GAME_SERVER_PORT,
  AVATARS,
  type AnswerSent,
  type ClientToServerEvents,
  type Game,
  type GameReport,
  type PlayerState,
  type Question,
  type ServerToClientEvents,
  type StageState,
} from '@pika-arena/shared';
import { io, type Socket } from 'socket.io-client';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

const args = process.argv.slice(2);
const want = args.find((a) => !a.startsWith('--')) ?? 'tpl-pika';
const url = args.find((a) => a.startsWith('--url='))?.slice(6) ?? `http://localhost:${GAME_SERVER_PORT}`;
const PLAYERS = Number(args.find((a) => a.startsWith('--players='))?.slice(10) ?? 6);
const address = new URL(url);
const path = `${address.pathname.replace(/\/+$/, '')}/socket.io`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connect = (): Sock => io(address.origin, { path, transports: ['websocket'], forceNew: true });

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
};

async function main() {
  const game: Game | undefined = SAMPLE_GAMES.find((g) => g.id === want);
  if (!game) throw new Error(`no sample game ${want}`);
  // the server gives each question its own id when the room opens, so match on the prompt, which is unique here
  const source = new Map<string, Question>(game.rounds.flatMap((r) => r.questions.map((q) => [q.prompt, q] as const)));
  console.log(`playing "${game.title}" — ${game.rounds.length} rounds, ${source.size} questions, ${PLAYERS} players\n`);

  const host = connect();
  await new Promise<void>((r) => host.on('connect', () => r()));
  const made = await host.emitWithAck('host:create', { game });
  if (!made.ok) throw new Error(`host:create: ${made.error}`);
  const { pin } = made;
  console.log(`room ${pin}`);

  // the bots: everyone answers right, except the last one, which sits out question 4
  const bots: Sock[] = [];
  const answered = new Map<string, Set<number>>();
  for (let i = 0; i < PLAYERS; i++) {
    const s = connect();
    await new Promise<void>((r) => s.on('connect', () => r()));
    const joined = await s.emitWithAck('player:join', { pin, nickname: `bot${i + 1}`, avatar: AVATARS[i % AVATARS.length]! });
    if (!joined.ok) throw new Error(`player:join: ${joined.error}`);
    s.on('player:state', (st: PlayerState) => {
      if (st.phase !== 'question' || !st.question) return;
      const q = st.question;
      const seen = answered.get(q.id) ?? new Set<number>();
      if (seen.has(i)) return;
      seen.add(i);
      answered.set(q.id, seen);
      if (i === PLAYERS - 1 && q.number === 4) return; // one player sits a question out
      const src = source.get(q.prompt)!;
      let a: AnswerSent = {};
      if (src.type === 'quiz' || src.type === 'truefalse') a = { choice: src.correct[0] };
      else if (src.type === 'poll') a = { choice: q.number % q.options.length };
      else if (src.type === 'type') a = { text: src.options[0] };
      else if (src.type === 'slider') a = { value: src.slider!.answer };
      else if (src.type === 'puzzle') a = { order: src.options.map((o) => q.options.indexOf(o)) };
      // answering only opens after the lead-in animation
      void sleep(Math.max(0, q.startsAt - Date.now()) + 120 + i * 40)
        .then(() => s.emitWithAck('player:answer', { questionId: q.id, ...a }))
        .then((res) => {
          if (!res.ok) console.log(`  bot${i + 1} refused on ${q.id}: ${res.error}`);
        });
    });
    bots.push(s);
  }
  console.log(`${bots.length} players in the lobby`);

  // the host presses Next, and closes answering as soon as everyone has answered
  let last = -1;
  const seenTypes = new Set<string>();
  const done = new Promise<GameReport>((resolve, reject) => {
    host.on('stage:state', (st: StageState) => {
      void (async () => {
        if (st.step === last) {
          if (st.phase === 'question' && st.question && st.answeredCount >= (st.question.number === 4 ? PLAYERS - 1 : PLAYERS)) {
            await sleep(120);
            host.emit('host:skip', { step: st.step });
          }
          return;
        }
        last = st.step;
        if (st.phase === 'question' && st.question) {
          seenTypes.add(st.question.type);
          console.log(`  q${st.question.number}/${st.question.total} ${st.question.type.padEnd(9)} ${st.question.prompt.slice(0, 48)}`);
          return;
        }
        if (st.phase === 'podium') {
          const got = await host.emitWithAck('host:report');
          if (!got.ok) return reject(new Error(`host:report: ${got.error}`));
          return resolve(got.report);
        }
        await sleep(150);
        host.emit('host:next', { step: st.step });
      })().catch(reject);
    });
  });
  host.emit('host:next');
  const report = await Promise.race([done, sleep(180_000).then(() => { throw new Error('the game never reached the podium'); })]);

  console.log('');
  check(report.questions.length === source.size, `the report has all ${source.size} questions (${report.questions.length})`);
  check(report.players.length === PLAYERS, `every player is in the report (${report.players.length})`);
  const types = [...new Set([...source.values()].map((q) => q.type))].sort();
  check(types.every((t) => seenTypes.has(t)), `every question type in the game was played (${types.join(', ')})`);
  for (const q of report.questions) {
    const src = source.get(q.prompt)!;
    const expectAnswered = q.number === 4 ? PLAYERS - 1 : PLAYERS;
    check(q.answered === expectAnswered, `q${q.number} ${q.type}: ${expectAnswered} answered (${q.answered})`);
    if (src.type !== 'poll') check(q.correctCount === expectAnswered, `q${q.number} ${q.type}: every answer scored right (${q.correctCount})`);
  }
  const scores = report.players.map((p) => p.score);
  check(Math.min(...scores) > 0, `everyone scored (lowest ${Math.min(...scores)}, highest ${Math.max(...scores)})`);
  const satOut = report.players.find((p) => p.nickname === `bot${PLAYERS}`)!;
  check(satOut.score < Math.max(...scores), 'the player who sat one out did not win');

  bots.forEach((b) => b.close());
  host.emit('host:close', { pin, hostToken: made.hostToken }, () => {});
  await sleep(300);
  host.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
