/**
 * A whole game played by bots and checked against the report the host reads at the end.
 *
 *   npm run crowd -- [--players=50] [--rooms=1] [--url=http://localhost:4000] [--ramp=100]
 *                    [--limit=10] [--payload=24] [--stage-payload=400] [--plain] [--quiet]
 *
 * Behind a reverse proxy, pass the app's address: --url=https://example.com/icebreaker
 *
 * `bots.ts` fills a room someone else opened and answers at random; this one opens the room, plays it to the
 * podium, and then says whether the server scored everyone the way it should have. So it is both the load test
 * and the check that a change to scoring, to the flow, or to what goes over the wire still holds up with a
 * crowd in the room.
 *
 * Unless --plain, the room is not a tidy one. Some bots dawdle until the timer is nearly out, one in ten drops
 * its connection right after answering and comes back on a new socket with its token, and one in ten answers
 * after the deadline on purpose. Those last ones have to be refused: a load test where every answer is sent at
 * a polite moment never finds out what happens when a phone wakes up late.
 *
 * What it checks, in every room:
 *   - every answer the server acked `ok` is in the report, and every answer it refused is not
 *   - an answer sent after the deadline (plus the grace) is always refused
 *   - the bots that meant to answer right are exactly the ones the report marks right, question by question
 *   - a bot that dropped and came back keeps the answer it sent before the drop
 *   - the ranking runs from most points to least, and every bot that answered right beat every bot that didn't
 *   - what one player receives stays within its budget — a player's traffic must not grow with the room
 */
import {
  ANSWER_GRACE_MS,
  AVATARS,
  GAME_SERVER_PORT,
  type ClientToServerEvents,
  type Game,
  type GameReport,
  type PlayerState,
  type Question,
  type QuestionPublic,
  type ServerToClientEvents,
  type StageState,
  validateGame,
} from '@icebreaker/shared';
import { io, type Socket } from 'socket.io-client';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

const args = process.argv.slice(2);
const text = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const num = (name: string, fallback: number) => Number(text(name, String(fallback)));
const has = (name: string) => args.includes(`--${name}`);

const ADDRESS = new URL(text('url', `http://localhost:${GAME_SERVER_PORT}`));
// a path in --url is where a proxy mounts the server, not a Socket.IO namespace
const SOCKET_PATH = `${ADDRESS.pathname.replace(/\/+$/, '')}/socket.io`;
const PLAYERS = num('players', 50);
const ROOMS = num('rooms', 1);
/** bots joining per second across every room, so the lobbies fill like real ones */
const RAMP = num('ramp', 100);
const LIMIT_S = num('limit', 10);
/** what one player may receive over this six-question game, in KiB */
const PLAYER_BUDGET = num('payload', 24) * 1024;
/**
 * What the big screen may receive per second, in KiB. A rate, not a lump: its traffic is capped by how often
 * the room may send it (`STAGE_MIN_GAP_MS`) and its state holds no list that grows with the room, so a longer
 * game costs more and a bigger one does not. An absolute budget would only measure how long the game ran.
 */
const STAGE_RATE_BUDGET = num('stage-payload', 6) * 1024;
/** every bot answers at a polite moment: no dawdling, no drops, no answers after the deadline */
const PLAIN = has('plain');
const QUIET = has('quiet');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connect = (): Sock => io(ADDRESS.origin, { path: SOCKET_PATH, transports: ['websocket'], forceNew: true, reconnection: false });
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

let failed = 0;
let passed = 0;
const check = (ok: boolean, what: string) => {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${what}`);
  }
  return ok;
};

// ---------- the game ----------

/** every type in one game: a timed round, then an untimed one worth double */
function gameFor(room: number): Game {
  return {
    id: `crowd-${room}`,
    title: `โหลดเทสต์ห้อง ${room + 1}`,
    rounds: [
      {
        id: 'r1',
        title: 'รอบจับเวลา',
        subtitle: 'ยิ่งตอบเร็วยิ่งได้คะแนน',
        questions: [
          { id: 'q1', type: 'quiz', prompt: 'ออฟฟิศใหม่ของเราอยู่ชั้นไหนของอาคาร', options: ['ชั้น 12', 'ชั้น 15', 'ชั้น 18', 'ชั้น 21'], correct: [2], timeLimitS: LIMIT_S },
          { id: 'q2', type: 'truefalse', prompt: 'ทีมเราไปเที่ยวทะเลด้วยกันทุกปี', options: ['จริง', 'เท็จ'], correct: [0], timeLimitS: LIMIT_S },
          { id: 'q3', type: 'poll', prompt: 'มื้อเที่ยงวันศุกร์นี้อยากกินอะไรกันดี', options: ['ส้มตำไก่ย่าง', 'ข้าวมันไก่', 'ชาบู', 'สลัดผัก'], correct: [], timeLimitS: LIMIT_S },
        ],
      },
      {
        id: 'r2',
        title: 'รอบไม่จับเวลา',
        subtitle: 'ตอบถูกได้เต็มทุกคน แล้วคูณสอง',
        multiplier: 2,
        timed: false,
        questions: [
          { id: 'q4', type: 'puzzle', prompt: 'เรียงเหตุการณ์ของบริษัทจากเก่าที่สุดไปใหม่ที่สุด', options: ['ก่อตั้งบริษัท', 'เปิดสาขาแรก', 'ย้ายออฟฟิศใหม่', 'ฉลองครบ 30 ปี'], correct: [], timeLimitS: LIMIT_S },
          { id: 'q5', type: 'type', prompt: 'หัวหน้าทีมของเรามีชื่อเล่นว่าอะไร', options: ['โอ๊ต', 'oat'], correct: [], timeLimitS: LIMIT_S },
          { id: 'q6', type: 'slider', prompt: 'ทีมเรามีสมาชิกทั้งหมดกี่คน', options: [], correct: [], timeLimitS: LIMIT_S, slider: { min: 0, max: 200, step: 1, answer: 48, margin: 3, unit: 'คน' } },
        ],
      },
    ],
  };
}

/**
 * The questions as the server will hold them, not as they were written: opening a room runs the game through
 * `validateGame`, which hands out its own ids (`q1-1`, `q1-2`, …). Reading them back from there is what keeps
 * a bot's answer pointed at the right question even if that naming ever changes.
 */
const checked = validateGame(gameFor(0));
if (!checked.ok) throw new Error(`the test's own game does not pass validation: ${checked.errors.join(' | ')}`);
const SOURCE = new Map<string, Question>(checked.game.rounds.flatMap((r) => r.questions.map((q) => [q.id, q] as const)));
/** a poll has no right answer, so it counts for nobody's `correctCount` */
const GRADED = new Set([...SOURCE.values()].filter((q) => q.type !== 'poll').map((q) => q.id));
const QUESTION_COUNT = SOURCE.size;

/** what bot `i` sends: the right answer, or one that is certainly wrong */
function answerFor(q: QuestionPublic, right: boolean, i: number): Record<string, unknown> {
  const src = SOURCE.get(q.id);
  if (!src) return {};
  switch (q.type) {
    case 'quiz':
    case 'truefalse': {
      const good = src.correct[0] ?? 0;
      return { choice: right ? good : (good + 1) % src.options.length };
    }
    case 'poll':
      // nothing to get wrong: spread the votes over the tiles
      return { choice: i % src.options.length };
    case 'puzzle': {
      // the options come shuffled, and the same way for everyone: say where each one really belongs
      const order = src.options.map((t) => q.options.indexOf(t));
      return { order: right ? order : [...order].reverse() };
    }
    case 'type':
      return { text: right ? (src.options[0] ?? '') : 'ไม่รู้จริงๆ นะ' };
    case 'slider':
      return { value: right ? (src.slider?.answer ?? 0) : (src.slider?.min ?? 0) };
    default:
      return {};
  }
}

// ---------- bots ----------

type Role = 'prompt' | 'slow' | 'flaky' | 'late';
/** the first four cover every role, so even a four-player room is not a tidy one */
const ROLES: Role[] = ['prompt', 'slow', 'flaky', 'late', 'prompt', 'prompt', 'slow', 'prompt', 'prompt', 'prompt'];
const roleOf = (i: number): Role => (PLAIN ? 'prompt' : (ROLES[i % ROLES.length] ?? 'prompt'));

interface Sent {
  ok: boolean;
  error: string;
  /** the server's own clock had passed the deadline before this answer could reach it */
  afterDeadline: boolean;
}

const joinMs: number[] = [];
const ackMs: number[] = [];
const trouble = new Map<string, number>();
const note = (what: string) => trouble.set(what, (trouble.get(what) ?? 0) + 1);

class Bot {
  readonly nickname: string;
  readonly role: Role;
  /** bot 0, 3, 6 … get everything wrong, so the board has both ends of it */
  readonly right: boolean;
  readonly sent = new Map<string, Sent>();
  private readonly answered = new Set<string>();
  private sock: Sock = connect();
  private offset = 0;
  /** the shortest round trip the clock has been measured over: how far off that measurement can be */
  private spread = Infinity;
  private token = '';
  private bytes = 0;
  private dropped = false;
  resumed = false;
  joined = false;

  constructor(
    private readonly room: Room,
    private readonly index: number,
  ) {
    this.nickname = `bot-${room.number + 1}-${String(index).padStart(4, '0')}`;
    this.role = roleOf(index);
    this.right = index % 3 !== 0;
    this.watch(this.sock);
    this.listen(this.sock);
  }

  /** every byte of every message this bot is sent, across the socket it drops and the one it comes back on */
  private watch(s: Sock) {
    s.io.on('open', () => {
      const engine = s.io.engine as unknown as { on(event: string, fn: (p: { type: string; data?: unknown }) => void): void };
      engine.on('packet', (p) => {
        if (p.type === 'message' && typeof p.data === 'string') this.bytes += Buffer.byteLength(p.data, 'utf8');
      });
    });
  }

  private listen(s: Sock) {
    s.on('player:state', (st: PlayerState) => {
      const q = st.question;
      if (st.phase !== 'question' || !q || this.answered.has(q.id)) return;
      this.answered.add(q.id);
      if (this.role === 'late') return void this.answerLate(q);
      const at = this.when(q);
      setTimeout(() => void this.answer(q), Math.max(0, at - this.serverNow()));
    });
    s.on('player:kicked', () => note('kicked'));
    s.on('room:closed', () => s.close());
  }

  private serverNow() {
    return Date.now() + this.offset;
  }

  /** server time this bot means to answer at */
  private when(q: QuestionPublic) {
    const span = q.endsAt - q.startsAt;
    if (this.role === 'slow') return q.startsAt + span * 0.8;
    return q.startsAt + 500 + Math.random() * Math.min(1500, span * 0.3);
  }

  /**
   * The server's clock, taken from the sample that made the shortest round trip. One sample is no good: a
   * thousand bots joining at once leave the ack sitting in a queue, and a reading taken then can be half a
   * second out — enough for a bot to answer before the question opens, or to think it answered late when it
   * did not.
   */
  private async sync(rounds: number) {
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      const at = await this.sock.timeout(15_000).emitWithAck('time:sync').catch(() => 0);
      const rtt = Date.now() - t0;
      if (at && rtt < this.spread) {
        this.spread = rtt;
        this.offset = at - t0 - rtt / 2;
      }
    }
  }

  /** read the clock again now the room has gone quiet, where the reading is worth far more */
  async resync() {
    this.spread = Infinity;
    await this.sync(3);
  }

  async join() {
    const t0 = Date.now();
    await this.sync(2);
    const r = await this.sock
      .timeout(20_000)
      .emitWithAck('player:join', { pin: this.room.pin, nickname: this.nickname, avatar: AVATARS[this.index % AVATARS.length] ?? AVATARS[0]! })
      .catch(() => ({ ok: false as const, error: 'timeout' }));
    if (!r.ok) return note(`join:${r.error}`);
    this.token = r.token;
    this.joined = true;
    joinMs.push(Date.now() - t0);
  }

  /**
   * Answers on purpose too late. Which moment that is cannot be taken from our own clock — under load it
   * drifts by more than the window is wide. So the server is asked the time first, on this same socket: the
   * answer that follows can only be handled after that reading, and if the reading is already past the
   * deadline the server has to refuse what comes next. No guesswork left in it.
   */
  private async answerLate(q: QuestionPublic) {
    for (let i = 0; i < 8; i++) {
      const at = await this.sock.timeout(15_000).emitWithAck('time:sync').catch(() => 0);
      if (!at) return note('late:no-clock');
      const left = q.endsAt + ANSWER_GRACE_MS - at;
      if (left < 0) return void (await this.answer(q, true));
      // wait out what the server says is left, and a little more, then ask it again before trusting that
      await sleep(left + 120);
    }
    note('late:never-sent');
  }

  private async answer(q: QuestionPublic, afterDeadline = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = this.sock;
      const t0 = Date.now();
      const r = await s
        .timeout(15_000)
        .emitWithAck('player:answer', { questionId: q.id, ...answerFor(q, this.right, this.index) })
        .catch(() => ({ ok: false as const, error: 'timeout' }));
      ackMs.push(Date.now() - t0);
      this.sent.set(q.id, { ok: r.ok, error: r.ok ? '' : r.error, afterDeadline });
      if (r.ok) {
        // one in ten drops right after answering: the answer has to survive it, and so has the score
        if (this.role === 'flaky' && !this.dropped) {
          this.dropped = true;
          await this.dropAndResume();
        }
        return;
      }
      if (afterDeadline) return;
      note(`answer:${r.error}`);
      // a clock still a shade ahead knocks before the question opens; a real client would try again too
      if (r.error !== 'not_open' || this.serverNow() > q.endsAt) return;
      await sleep(350);
    }
  }

  private async dropAndResume() {
    this.sock.close();
    await sleep(250);
    this.sock = connect();
    this.watch(this.sock);
    this.listen(this.sock);
    const r = await this.sock
      .timeout(15_000)
      .emitWithAck('player:resume', { pin: this.room.pin, token: this.token })
      .catch(() => ({ ok: false as const, error: 'timeout' }));
    this.resumed = r.ok;
    if (!r.ok) note(`resume:${r.error}`);
  }

  received() {
    return this.bytes;
  }

  close() {
    this.sock.close();
  }
}

// ---------- one room, from the lobby to the podium ----------

class Room {
  pin = '';
  private hostToken = '';
  private stageToken = '';
  private host: Sock = connect();
  private stage: Sock | null = null;
  private state: StageState | null = null;
  private stageBytes = 0;
  readonly bots: Bot[] = [];

  constructor(readonly number: number) {}

  async open() {
    this.host.on('stage:state', (s) => (this.state = s));
    const r = await this.host
      .timeout(20_000)
      .emitWithAck('host:create', { game: gameFor(this.number) })
      .catch(() => ({ ok: false as const, error: 'timeout' }));
    if (!r.ok) throw new Error(`the room would not open: ${r.error}`);
    this.pin = r.pin;
    this.hostToken = r.hostToken;
    this.stageToken = r.stageToken;
    // the big screen watches too, so its share of the traffic is measured with everyone else's
    this.stage = connect();
    this.stage.io.on('open', () => {
      const engine = this.stage!.io.engine as unknown as { on(event: string, fn: (p: { type: string; data?: unknown }) => void): void };
      engine.on('packet', (p) => {
        if (p.type === 'message' && typeof p.data === 'string') this.stageBytes += Buffer.byteLength(p.data, 'utf8');
      });
    });
    const attached = await this.stage
      .timeout(20_000)
      .emitWithAck('stage:attach', { pin: this.pin, stageToken: this.stageToken })
      .catch(() => ({ ok: false as const, error: 'timeout' }));
    if (!attached.ok) note(`stage:${attached.error}`);
    for (const i of range(PLAYERS)) this.bots.push(new Bot(this, i));
  }

  private async until(fn: (s: StageState) => boolean, what: string, ms = 120_000) {
    const end = Date.now() + ms;
    while (!(this.state && fn(this.state))) {
      if (Date.now() > end) throw new Error(`room ${this.pin}: timed out waiting for ${what} (phase ${this.state?.phase ?? 'none'})`);
      await sleep(50);
    }
  }

  /** drives the room the way a host does: the server opens and closes every question by itself */
  async play(): Promise<GameReport> {
    const seated = this.bots.filter((b) => b.joined).length;
    await this.until((s) => s.playerCount >= seated, 'everyone to be in the lobby');
    check(seated === PLAYERS, `room ${this.pin}: all ${PLAYERS} bots got in (${seated})`);
    await Promise.all(this.bots.filter((b) => b.joined).map((b) => b.resync()));
    this.host.emit('host:next');
    let last = '';
    const key = (s: StageState) => `${s.phase}-${s.round?.index ?? -1}-${s.question?.id ?? ''}`;
    for (;;) {
      await this.until((s) => key(s) !== last, `the scene after ${last || 'the lobby'}`);
      const s = this.state!;
      last = key(s);
      if (s.phase === 'reveal' || s.phase === 'leaderboard') {
        // long enough that the reveal and the board actually go out to everyone before the next scene
        await sleep(1200);
        this.host.emit('host:next');
      } else if (s.phase === 'podium') break;
    }
    const r = await this.host.timeout(20_000).emitWithAck('host:report').catch(() => ({ ok: false as const, error: 'timeout' }));
    if (!r.ok) throw new Error(`room ${this.pin}: no report (${r.error})`);
    return r.report;
  }

  stageReceived() {
    return this.stageBytes;
  }

  async close() {
    await this.host.timeout(10_000).emitWithAck('host:close', { pin: this.pin, hostToken: this.hostToken }).catch(() => ({ ok: false }));
    this.stage?.close();
    this.host.close();
    for (const b of this.bots) b.close();
  }
}

// ---------- what the report has to say ----------

function verify(room: Room, report: GameReport) {
  const at = `room ${room.pin}`;
  const rows = new Map(report.players.map((p) => [p.nickname, p]));
  const bots = room.bots.filter((b) => b.joined);

  check(report.playerCount === bots.length, `${at}: the report counts every player (${report.playerCount} of ${bots.length})`);
  check(report.questions.length === QUESTION_COUNT, `${at}: the report has all ${QUESTION_COUNT} questions`);

  // the one that fails loudly when the bots are sending nonsense: without it the checks below only prove the
  // report agrees with the refusals, which it does perfectly well when every single answer was refused
  const onTime = bots.filter((b) => b.role !== 'late');
  const landed = onTime.filter((b) => b.sent.size === QUESTION_COUNT && [...b.sent.values()].every((r) => r.ok));
  check(landed.length === onTime.length, `${at}: every bot that answered in time got all ${QUESTION_COUNT} in (${onTime.length - landed.length} did not)`);

  let mismatchedPlayers = 0;
  for (const b of bots) {
    const p = rows.get(b.nickname);
    if (!p) {
      mismatchedPlayers++;
      continue;
    }
    const accepted = [...b.sent].filter(([, r]) => r.ok).map(([id]) => id);
    const wantCorrect = b.right ? accepted.filter((id) => GRADED.has(id)).length : 0;
    if (p.answeredCount !== accepted.length || p.correctCount !== wantCorrect || p.gradedCount !== GRADED.size) {
      if (mismatchedPlayers === 0)
        console.log(
          `  ${b.nickname} (${b.role}, ${b.right ? 'right' : 'wrong'}): report says answered ${p.answeredCount} correct ${p.correctCount} graded ${p.gradedCount}, ` +
            `the server acked ${accepted.length} ok of ${b.sent.size} sent (${[...b.sent].map(([id, r]) => `${id}:${r.ok ? 'ok' : r.error}`).join(' ')})`,
        );
      mismatchedPlayers++;
    }
  }
  check(mismatchedPlayers === 0, `${at}: every player's answers and right answers match what the server acked (${mismatchedPlayers} do not)`);

  let mismatchedQuestions = 0;
  for (const q of report.questions) {
    const id = [...SOURCE.keys()][q.number - 1];
    if (!id) continue;
    const accepted = bots.filter((b) => b.sent.get(id)?.ok);
    const want = GRADED.has(id) ? accepted.filter((b) => b.right).length : 0;
    if (q.answered !== accepted.length || q.correctCount !== want) {
      console.log(`  q${q.number} (${q.type}): report says answered ${q.answered} correct ${q.correctCount}, the server acked ${accepted.length} ok and ${want} of them right`);
      mismatchedQuestions++;
    }
  }
  check(mismatchedQuestions === 0, `${at}: every question's counts match what the server acked (${mismatchedQuestions} do not)`);

  // answers that went in after the deadline
  const afterDeadline = bots.flatMap((b) => [...b.sent.values()].filter((r) => r.afterDeadline));
  if (!PLAIN) check(afterDeadline.length > 0, `${at}: some answers did go in after the deadline (${afterDeadline.length})`);
  check(afterDeadline.every((r) => !r.ok), `${at}: every answer sent after the deadline was refused (${afterDeadline.filter((r) => r.ok).length} were not)`);

  // the ones that dropped and came back
  const flaky = bots.filter((b) => b.role === 'flaky');
  if (flaky.length) {
    check(
      flaky.every((b) => b.resumed),
      `${at}: every bot that dropped got back in with its token (${flaky.filter((b) => !b.resumed).length} did not)`,
    );
    const kept = flaky.filter((b) => (rows.get(b.nickname)?.answeredCount ?? 0) === b.sent.size);
    check(kept.length === flaky.length, `${at}: the answer sent before a drop still counts (${flaky.length - kept.length} lost one)`);
  }

  // the board
  const scores = report.players.map((p) => p.score);
  check(
    scores.every((s, i) => i === 0 || (scores[i - 1] ?? 0) >= s),
    `${at}: the ranking runs from most points to least`,
  );
  const rightScores = bots.filter((b) => b.right && b.role !== 'late').map((b) => rows.get(b.nickname)?.score ?? 0);
  const restScores = bots.filter((b) => !b.right || b.role === 'late').map((b) => rows.get(b.nickname)?.score ?? 0);
  if (rightScores.length && restScores.length)
    check(Math.min(...rightScores) > Math.max(...restScores), `${at}: every bot that answered right beat every bot that did not`);
}

// ---------- running it ----------

const percentile = (sorted: number[], p: number) => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0) : 0);
const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`;

console.log(`crowd: ${ROOMS} room${ROOMS === 1 ? '' : 's'} × ${PLAYERS} players on ${ADDRESS.origin}${SOCKET_PATH}${PLAIN ? ' (plain)' : ''}`);
const started = Date.now();
const rooms = range(ROOMS).map((i) => new Room(i));
for (const r of rooms) await r.open();
console.log(`PIN ${rooms.map((r) => r.pin).join(', ')} · ${ROOMS * PLAYERS} bots joining at ${RAMP}/s`);

const everyBot = rooms.flatMap((r) => r.bots);
await Promise.all(everyBot.map((b, i) => sleep((i / RAMP) * 1000).then(() => b.join())));
const seated = everyBot.filter((b) => b.joined).length;
console.log(`${seated}/${everyBot.length} in the lobby after ${((Date.now() - started) / 1000).toFixed(1)}s`);

const ticker = QUIET
  ? null
  : setInterval(() => {
      const sorted = [...ackMs].sort((a, b) => a - b);
      console.log(`  ${sorted.length} answers acked · p50 ${percentile(sorted, 50)} ms · p95 ${percentile(sorted, 95)} ms · max ${sorted.at(-1) ?? 0} ms`);
    }, 10_000);

let reports: (GameReport | null)[] = [];
try {
  reports = await Promise.all(
    rooms.map(async (r) => {
      try {
        return await r.play();
      } catch (e) {
        check(false, (e as Error).message);
        return null;
      }
    }),
  );
} finally {
  if (ticker) clearInterval(ticker);
}

for (const [i, report] of reports.entries()) if (report) verify(rooms[i]!, report);

// what one player and one big screen were sent over the whole game
const perPlayer = everyBot.map((b) => b.received()).sort((a, b) => a - b);
const perStage = rooms.map((r) => r.stageReceived()).sort((a, b) => a - b);
const worstPlayer = perPlayer.at(-1) ?? 0;
const worstStage = perStage.at(-1) ?? 0;
const seconds = (Date.now() - started) / 1000;
const stageRate = worstStage / seconds;
check(worstPlayer <= PLAYER_BUDGET, `a player was sent at most ${kib(PLAYER_BUDGET)} over the game (worst ${kib(worstPlayer)})`);
check(stageRate <= STAGE_RATE_BUDGET, `the big screen was sent at most ${kib(STAGE_RATE_BUDGET)} a second (worst ${kib(stageRate)})`);

const joins = [...joinMs].sort((a, b) => a - b);
const acks = [...ackMs].sort((a, b) => a - b);
console.log('');
console.log('='.repeat(60));
console.log(`joined   ${seated}/${everyBot.length} · p50 ${percentile(joins, 50)} ms · p95 ${percentile(joins, 95)} ms · max ${joins.at(-1) ?? 0} ms`);
console.log(`answered ${acks.length} · p50 ${percentile(acks, 50)} ms · p95 ${percentile(acks, 95)} ms · max ${acks.at(-1) ?? 0} ms`);
console.log(`payload  player p50 ${kib(percentile(perPlayer, 50))} · worst ${kib(worstPlayer)} of ${kib(PLAYER_BUDGET)} · big screen worst ${kib(worstStage)}, ${kib(stageRate)}/s of ${kib(STAGE_RATE_BUDGET)}/s`);
console.log(`trouble  ${[...trouble].map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`);
console.log(`took     ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('='.repeat(60));

for (const r of rooms) await r.close();
console.log(failed ? `${passed} passed, ${failed} FAILED` : `${passed} passed\nALL PASSED`);
process.exit(failed ? 1 : 0);
