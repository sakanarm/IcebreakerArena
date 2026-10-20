import { randomBytes, randomInt } from 'node:crypto';
import {
  isOrder,
  isRightOrder,
  leadInMs,
  LIMITS,
  matchTyped,
  MAX_PLAYERS_PER_ROOM,
  onScale,
  scoreAnswer,
  sliderBin,
  sliderBins,
  sliderCloseness,
  type AnswerKey,
  type AnswerSent,
  type Award,
  type Game,
  type GameReport,
  type LeaderRow,
  type Phase,
  type PlayerLite,
  type PlayerResult,
  type PlayerState,
  type Question,
  type QuestionPublic,
  type Result,
  type RevealInfo,
  type Round,
  type RoundInfo,
  type StageState,
} from '@icebreaker/shared';
import type { IO } from './io';

/** the full leaderboard and answer counts reach the Stage at most 4 times a second */
const STAGE_MIN_GAP_MS = 250;
/** the lobby shows the newest players only; the counter shows everyone */
const LOBBY_LIST_CAP = 200;
/** answers still in flight when the timer hits 0 are accepted */
const ANSWER_GRACE_MS = 300;
const ROUND_INTRO_MS = 3500;
const ALL_ANSWERED_DELAY_MS = 400;

interface Answer {
  sent: AnswerSent;
  responseMs: number;
}

/** how one answer came out: right or not, how close (slider), and which bar of the reveal chart it adds to */
interface Judged {
  correct: boolean | null;
  closeness: number;
  bar: number | null;
}

interface Player {
  id: string;
  token: string;
  nickname: string;
  avatar: string;
  socketId: string | null;
  joinedAt: number;
  score: number;
  prevScore: number;
  rank: number | null;
  prevRank: number | null;
  streak: number;
  bestStreak: number;
  correctMs: number;
  answers: Map<string, Answer>;
  results: Map<string, PlayerResult>;
}

interface Slot {
  q: Question;
  round: Round;
  roundIndex: number;
  number: number;
}

const newId = (bytes: number) => randomBytes(bytes).toString('base64url');

export class Room {
  readonly hostToken = newId(18);
  phase: Phase = 'lobby';
  lastActivity = Date.now();
  startedAt: number | null = null;
  endedAt: number | null = null;

  private players = new Map<string, Player>();
  private byToken = new Map<string, Player>();
  /** players by rank; recomputed at every reveal (scores only change there) */
  private ranking: Player[] = [];
  private slots: Slot[];
  private slotIndex = -1;
  private roundIndex = -1;
  /** `shown` is a puzzle's shuffle: shown[k] = the authored position of the k-th item players see */
  private current: { slot: Slot; startsAt: number; endsAt: number; shown: number[] | null } | null = null;
  private answeredCount = 0;
  private revealInfo: RevealInfo | null = null;
  private stats = new Map<string, RevealInfo>();
  private timer: NodeJS.Timeout | null = null;
  private stageTimer: NodeJS.Timeout | null = null;
  private lastStageEmit = 0;

  constructor(
    readonly pin: string,
    readonly game: Game,
    private readonly io: IO,
  ) {
    this.slots = game.rounds.flatMap((round, roundIndex) => round.questions.map((q) => ({ q, round, roundIndex, number: 0 })));
    this.slots.forEach((s, i) => (s.number = i + 1));
  }

  get stageChannel() {
    return `stage:${this.pin}`;
  }

  // ---------- players ----------

  addPlayer(nickname: string, avatar: string, socketId: string): Player | 'full' {
    if (this.players.size >= MAX_PLAYERS_PER_ROOM) return 'full';
    const player: Player = {
      id: newId(6),
      token: newId(18),
      nickname: this.uniqueName(nickname),
      avatar,
      socketId,
      joinedAt: Date.now(),
      score: 0,
      prevScore: 0,
      rank: null,
      prevRank: null,
      streak: 0,
      bestStreak: 0,
      correctMs: 0,
      answers: new Map(),
      results: new Map(),
    };
    this.players.set(player.id, player);
    this.byToken.set(player.token, player);
    this.touch();
    this.queueStage();
    return player;
  }

  resume(token: string, socketId: string): Player | null {
    const player = this.byToken.get(token);
    if (!player) return null;
    player.socketId = socketId;
    this.touch();
    this.queueStage();
    return player;
  }

  disconnect(playerId: string, socketId: string) {
    const player = this.players.get(playerId);
    if (player?.socketId !== socketId) return;
    player.socketId = null;
    this.queueStage();
  }

  /** returns the kicked player's socket id, if they were connected */
  kick(playerId: string): string | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    this.players.delete(player.id);
    this.byToken.delete(player.token);
    this.ranking = this.ranking.filter((p) => p !== player);
    this.ranking.forEach((p, i) => (p.rank = i + 1));
    this.queueStage(true);
    return player.socketId;
  }

  sendPlayerState(player: { id: string }) {
    const p = this.players.get(player.id);
    if (p?.socketId) this.io.to(p.socketId).emit('player:state', this.playerState(p));
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.nickname.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.socketId) n++;
    return n;
  }

  // ---------- host controls ----------

  /** The single Kahoot-style "Next" button. */
  next() {
    this.touch();
    switch (this.phase) {
      case 'lobby':
        if (this.players.size === 0) return;
        this.startedAt = Date.now();
        return this.goToSlot(0);
      case 'round':
        return this.openQuestion();
      case 'question':
        return this.reveal();
      case 'reveal':
        return this.slotIndex >= this.slots.length - 1 ? this.enterPodium() : this.setPhase('leaderboard');
      case 'leaderboard':
        return this.goToSlot(this.slotIndex + 1);
      case 'podium':
        return;
    }
  }

  skip() {
    this.touch();
    if (this.phase === 'round') this.openQuestion();
    else if (this.phase === 'question') this.reveal();
  }

  end() {
    this.touch();
    if (this.phase === 'question') this.reveal();
    if (this.phase !== 'lobby') this.enterPodium();
  }

  // ---------- game flow ----------

  private goToSlot(index: number) {
    const slot = this.slots[index];
    if (!slot) return this.enterPodium();
    this.slotIndex = index;
    if (slot.roundIndex !== this.roundIndex) {
      this.roundIndex = slot.roundIndex;
      this.setPhase('round');
      this.schedule(ROUND_INTRO_MS, () => this.openQuestion());
      return;
    }
    this.openQuestion();
  }

  private openQuestion() {
    const slot = this.slots[this.slotIndex];
    if (!slot) return;
    const now = Date.now();
    const startsAt = now + leadInMs(slot.q.prompt);
    const endsAt = startsAt + slot.q.timeLimitS * 1000;
    this.current = { slot, startsAt, endsAt, shown: slot.q.type === 'puzzle' ? shuffled(slot.q.options.length) : null };
    this.answeredCount = 0;
    this.revealInfo = null;
    this.setPhase('question');
    this.schedule(endsAt - now + ANSWER_GRACE_MS, () => this.reveal());
  }

  answer(playerId: string, questionId: string, input: unknown): Result {
    const cur = this.current;
    if (this.phase !== 'question' || !cur || cur.slot.q.id !== questionId) return { ok: false, error: 'not_open' };
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: 'not_allowed' };
    const sent = readAnswer(cur.slot.q, input);
    if (!sent) return { ok: false, error: 'bad_request' };
    if (player.answers.has(questionId)) return { ok: false, error: 'already_answered' };
    const now = Date.now();
    if (now < cur.startsAt - 100) return { ok: false, error: 'not_open' };
    if (now > cur.endsAt + ANSWER_GRACE_MS) return { ok: false, error: 'too_late' };

    // response time is measured on the server only: from when answering opened to when the answer arrived
    const responseMs = Math.min(Math.max(now - cur.startsAt, 0), cur.slot.q.timeLimitS * 1000);
    player.answers.set(questionId, { sent, responseMs });
    this.answeredCount++;
    this.touch();
    this.queueStage();
    if (this.answeredCount >= this.connectedCount()) this.schedule(ALL_ANSWERED_DELAY_MS, () => this.reveal());
    return { ok: true };
  }

  /** Scores are computed here and only here, once per question. */
  private reveal() {
    const cur = this.current;
    if (this.phase !== 'question' || !cur) return;
    const { q, round } = cur.slot;
    const timed = round.timed !== false;
    const multiplier = (q.multiplier ?? 1) * (round.multiplier ?? 1);
    const counts = Array.from({ length: barCount(q) }, () => 0);
    let answered = 0;
    let correctCount = 0;
    let correctMsSum = 0;
    let valueSum = 0;

    for (const p of this.players.values()) {
      const a = p.answers.get(q.id);
      const { correct, closeness, bar } = judge(q, cur.shown, a?.sent);
      if (a) {
        if (bar !== null) counts[bar] = (counts[bar] ?? 0) + 1;
        valueSum += a.sent.value ?? 0;
        answered++;
        if (correct) {
          correctCount++;
          correctMsSum += a.responseMs;
          p.correctMs += a.responseMs;
        }
      }
      const { points, streak } = scoreAnswer({
        type: q.type,
        answered: !!a,
        correct,
        responseMs: a?.responseMs ?? 0,
        timeLimitS: q.timeLimitS,
        timed,
        multiplier,
        streakBefore: p.streak,
        streakBonus: !!this.game.settings?.streakBonus,
        closeness,
      });
      p.prevScore = p.score;
      p.score += points;
      p.streak = streak;
      p.bestStreak = Math.max(p.bestStreak, streak);
      p.results.set(q.id, { questionId: q.id, answered: !!a, correct, points, streak, responseMs: a?.responseMs ?? null });
    }

    this.rerank();
    const key = answerKey(q);
    this.revealInfo = {
      correct: q.correct,
      counts,
      ...(key ? { key } : {}),
      ...(q.type === 'slider' ? { average: answered ? Math.round((valueSum / answered) * 10) / 10 : null } : {}),
      answered,
      totalPlayers: this.players.size,
      correctCount,
      avgCorrectMs: correctCount ? Math.round(correctMsSum / correctCount) : null,
    };
    this.stats.set(q.id, this.revealInfo);
    this.setPhase('reveal');
  }

  private rerank() {
    const list = [...this.players.values()];
    for (const p of list) p.prevRank = p.rank;
    // ties go to whoever was faster on their correct answers
    list.sort((a, b) => b.score - a.score || a.correctMs - b.correctMs || a.joinedAt - b.joinedAt);
    list.forEach((p, i) => (p.rank = i + 1));
    this.ranking = list;
  }

  private enterPodium() {
    this.endedAt = Date.now();
    this.setPhase('podium');
  }

  private setPhase(phase: Phase) {
    this.clearTimer();
    this.phase = phase;
    this.queueStage(true);
    for (const p of this.players.values()) this.sendPlayerState(p);
  }

  private schedule(ms: number, fn: () => void) {
    this.clearTimer();
    this.timer = setTimeout(fn, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private touch() {
    this.lastActivity = Date.now();
  }

  // ---------- what each screen gets ----------

  /** Phase changes go out at once; streaming updates (joins, answer counts) are throttled. */
  private queueStage(immediate = false) {
    if (immediate) return this.emitStage();
    if (this.stageTimer) return;
    const wait = Math.max(0, STAGE_MIN_GAP_MS - (Date.now() - this.lastStageEmit));
    this.stageTimer = setTimeout(() => this.emitStage(), wait);
  }

  private emitStage() {
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.stageTimer = null;
    this.lastStageEmit = Date.now();
    this.io.to(this.stageChannel).emit('stage:state', this.stageState());
  }

  stageState(): StageState {
    const inPhase = (phase: Phase) => this.phase === phase;
    return {
      pin: this.pin,
      gameTitle: this.game.title,
      cover: this.game.cover ?? null,
      phase: this.phase,
      playerCount: this.players.size,
      players: inPhase('lobby') ? [...this.players.values()].slice(-LOBBY_LIST_CAP).map(toLite) : [],
      round: this.roundInfo(),
      question: this.questionPublic(),
      answeredCount: this.answeredCount,
      reveal: inPhase('reveal') ? this.revealInfo : null,
      leaderboard: inPhase('leaderboard') ? this.ranking.slice(0, 5).map(toRow) : [],
      podium: inPhase('podium') ? this.ranking.slice(0, 3).map(toRow) : [],
      awards: inPhase('podium') ? this.awards() : [],
      isLastQuestion: this.slotIndex >= this.slots.length - 1,
    };
  }

  private playerState(p: Player): PlayerState {
    const question = this.questionPublic();
    const above = p.rank && p.rank > 1 ? this.ranking[p.rank - 2] : undefined;
    const revealed = this.phase === 'reveal' && question;
    return {
      pin: this.pin,
      gameTitle: this.game.title,
      phase: this.phase,
      me: {
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        score: p.score,
        rank: p.rank,
        streak: p.streak,
        gapToAbove: above ? above.score - p.score : null,
        aboveNickname: above?.nickname ?? null,
        totalPlayers: this.players.size,
      },
      round: this.roundInfo(),
      question,
      myAnswer: question ? (p.answers.get(question.id)?.sent ?? null) : null,
      result: revealed ? (p.results.get(question.id) ?? null) : null,
      correctChoices: revealed ? this.current!.slot.q.correct : null,
      key: revealed ? answerKey(this.current!.slot.q) : null,
    };
  }

  private roundInfo(): RoundInfo | null {
    const r = this.game.rounds[this.roundIndex];
    if (!r) return null;
    return {
      index: this.roundIndex,
      total: this.game.rounds.length,
      title: r.title,
      ...(r.subtitle ? { subtitle: r.subtitle } : {}),
      multiplier: r.multiplier ?? 1,
      timed: r.timed !== false,
      questionCount: r.questions.length,
    };
  }

  private questionPublic(): QuestionPublic | null {
    const cur = this.current;
    if (!cur || (this.phase !== 'question' && this.phase !== 'reveal')) return null;
    const { q, round, roundIndex, number } = cur.slot;
    return {
      id: q.id,
      number,
      total: this.slots.length,
      roundIndex,
      type: q.type,
      prompt: q.prompt,
      // nothing here may give the answer away: a puzzle goes out shuffled, typed answers and the slider's answer not at all
      options: cur.shown ? cur.shown.map((i) => q.options[i]!) : q.type === 'type' || q.type === 'slider' ? [] : q.options,
      ...(q.slider ? { slider: { min: q.slider.min, max: q.slider.max, step: q.slider.step, ...(q.slider.unit ? { unit: q.slider.unit } : {}) } } : {}),
      timeLimitS: q.timeLimitS,
      multiplier: (q.multiplier ?? 1) * (round.multiplier ?? 1),
      timed: round.timed !== false,
      ...(q.imageUrl ? { imageUrl: q.imageUrl } : {}),
      startsAt: cur.startsAt,
      endsAt: cur.endsAt,
    };
  }

  private awards(): Award[] {
    const awards: Award[] = [];
    const withCorrect = this.ranking.map((p) => ({ p, n: [...p.results.values()].filter((r) => r.correct).length }));
    const most = Math.max(0, ...withCorrect.map((x) => x.n));
    // fastest on average, among players who got at least half as many right as the best player
    const fastest = withCorrect
      .filter((x) => x.n > 0 && x.n * 2 >= most)
      .sort((a, b) => a.p.correctMs / a.n - b.p.correctMs / b.n)[0];
    if (fastest) {
      awards.push({
        kind: 'fastest',
        title: 'ตอบไวที่สุด',
        nickname: fastest.p.nickname,
        avatar: fastest.p.avatar,
        value: `เฉลี่ย ${(fastest.p.correctMs / fastest.n / 1000).toFixed(2)} วิ/ข้อ`,
      });
    }
    const streaker = [...this.ranking].sort((a, b) => b.bestStreak - a.bestStreak)[0];
    if (streaker && streaker.bestStreak >= 2) {
      awards.push({
        kind: 'streak',
        title: 'Streak ยาวที่สุด',
        nickname: streaker.nickname,
        avatar: streaker.avatar,
        value: `ถูกติดกัน ${streaker.bestStreak} ข้อ`,
      });
    }
    return awards;
  }

  report(): GameReport {
    const players = [...this.players.values()].sort((a, b) => b.score - a.score || a.correctMs - b.correctMs);
    return {
      pin: this.pin,
      gameTitle: this.game.title,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      playerCount: this.players.size,
      questions: this.slots.flatMap(({ q, round, number }) => {
        const s = this.stats.get(q.id);
        if (!s) return [];
        return [{
          number,
          roundTitle: round.title,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          correct: q.correct,
          counts: s.counts,
          ...(q.slider ? { slider: q.slider, average: s.average ?? null } : {}),
          answered: s.answered,
          correctCount: s.correctCount,
          avgMs: s.avgCorrectMs,
        }];
      }),
      players: players.map((p, i) => {
        const results = [...p.results.values()];
        const answered = results.filter((r) => r.answered);
        const msSum = answered.reduce((sum, r) => sum + (r.responseMs ?? 0), 0);
        return {
          rank: i + 1,
          nickname: p.nickname,
          avatar: p.avatar,
          score: p.score,
          correctCount: results.filter((r) => r.correct).length,
          // polls have no right answer (correct is null), so they don't count against anyone
          gradedCount: results.filter((r) => r.correct !== null).length,
          answeredCount: answered.length,
          avgMs: answered.length ? Math.round(msSum / answered.length) : null,
          bestStreak: p.bestStreak,
        };
      }),
    };
  }

  close() {
    this.clearTimer();
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.io.to(this.stageChannel).emit('room:closed');
    for (const p of this.players.values()) if (p.socketId) this.io.to(p.socketId).emit('room:closed');
  }
}

/** A fresh shuffle of n items that never leaves them in the authored (right) order. */
export function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return order;
  do {
    for (let i = n - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
  } while (order.every((v, i) => v === i));
  return order;
}

/** The player's answer in the shape the question takes, or null when it doesn't fit. */
function readAnswer(q: Question, input: unknown): AnswerSent | null {
  if (typeof input !== 'object' || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (q.type) {
    case 'puzzle':
      return isOrder(a.order, q.options.length) ? { order: [...a.order] } : null;
    case 'type': {
      const text = typeof a.text === 'string' ? a.text.trim() : '';
      return text && text.length <= LIMITS.typedMax ? { text } : null;
    }
    case 'slider':
      return q.slider && onScale(q.slider, a.value) ? { value: a.value } : null;
    default: {
      const choice = a.choice;
      return typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < q.options.length ? { choice } : null;
    }
  }
}

function judge(q: Question, shown: number[] | null, a: AnswerSent | undefined): Judged {
  if (q.type === 'poll') return { correct: null, closeness: 1, bar: a?.choice ?? null };
  if (!a) return { correct: false, closeness: 1, bar: null };
  switch (q.type) {
    case 'puzzle':
      return { correct: !!shown && !!a.order && isRightOrder(shown, a.order), closeness: 1, bar: null };
    case 'type': {
      const match = matchTyped(q.options, a.text ?? '');
      return { correct: match >= 0, closeness: 1, bar: match >= 0 ? match : null };
    }
    case 'slider': {
      if (!q.slider || a.value === undefined) return { correct: false, closeness: 1, bar: null };
      const closeness = sliderCloseness(q.slider, a.value);
      return { correct: closeness > 0, closeness, bar: sliderBin(q.slider, a.value) };
    }
    default:
      return { correct: a.choice !== undefined && q.correct.includes(a.choice), closeness: 1, bar: a.choice ?? null };
  }
}

/** bars on the reveal chart: one per tile or accepted answer, stretches of a slider's scale, none for a puzzle */
function barCount(q: Question): number {
  if (q.type === 'puzzle') return 0;
  if (q.type === 'slider') return q.slider ? sliderBins(q.slider) : 0;
  return q.options.length;
}

/** what a reveal shows besides the right tiles: a puzzle's order, the accepted typed answers, the slider's answer */
function answerKey(q: Question): AnswerKey | null {
  if (q.type === 'puzzle' || q.type === 'type') return { texts: q.options };
  if (q.type === 'slider' && q.slider) return { answer: q.slider.answer, margin: q.slider.margin };
  return null;
}

const toLite = (p: Player): PlayerLite => ({
  id: p.id,
  nickname: p.nickname,
  avatar: p.avatar,
  connected: p.socketId !== null,
});

const toRow = (p: Player): LeaderRow => ({
  id: p.id,
  nickname: p.nickname,
  avatar: p.avatar,
  score: p.score,
  prevScore: p.prevScore,
  rank: p.rank ?? 0,
  prevRank: p.prevRank,
  streak: p.streak,
});
