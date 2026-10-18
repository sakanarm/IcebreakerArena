// ---------- Game content (what a Host authors) ----------

export type QuestionType = 'quiz' | 'truefalse' | 'poll';

/** 0 = no points, 1 = standard, 2 = double points */
export type QuestionMultiplier = 0 | 1 | 2;

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  /** 2–4 options; truefalse always has exactly 2 */
  options: string[];
  /** indices of the correct options; empty for poll */
  correct: number[];
  timeLimitS: number;
  multiplier?: QuestionMultiplier;
  imageUrl?: string;
}

export interface Round {
  id: string;
  title: string;
  subtitle?: string;
  /** applied on top of the question multiplier, e.g. Final Round ×2 */
  multiplier?: number;
  /** false = accuracy mode ("ไม่นับเวลา"): every correct answer scores 1,000 */
  timed?: boolean;
  questions: Question[];
}

export interface GameSettings {
  /** +100 per consecutive correct answer, up to +500. Off by default; the streak is still shown. */
  streakBonus?: boolean;
}

export interface Game {
  id: string;
  title: string;
  description?: string;
  rounds: Round[];
  settings?: GameSettings;
}

// ---------- Live session ----------

export type Phase = 'lobby' | 'round' | 'question' | 'reveal' | 'leaderboard' | 'podium';

export interface PlayerLite {
  id: string;
  nickname: string;
  avatar: string;
  connected: boolean;
}

export interface RoundInfo {
  index: number;
  total: number;
  title: string;
  subtitle?: string;
  multiplier: number;
  timed: boolean;
  questionCount: number;
}

/** A question as clients see it: never contains the correct answer. */
export interface QuestionPublic {
  id: string;
  /** 1-based position across the whole game */
  number: number;
  total: number;
  roundIndex: number;
  type: QuestionType;
  prompt: string;
  options: string[];
  timeLimitS: number;
  /** effective multiplier = question × round */
  multiplier: number;
  timed: boolean;
  imageUrl?: string;
  /** server epoch ms when answering opens (after the lead-in animation) */
  startsAt: number;
  /** server epoch ms when answering closes */
  endsAt: number;
}

export interface RevealInfo {
  /** empty for poll */
  correct: number[];
  counts: number[];
  answered: number;
  totalPlayers: number;
  correctCount: number;
  avgCorrectMs: number | null;
}

export interface LeaderRow {
  id: string;
  nickname: string;
  avatar: string;
  score: number;
  prevScore: number;
  rank: number;
  prevRank: number | null;
  streak: number;
}

export interface Award {
  kind: 'fastest' | 'streak';
  title: string;
  nickname: string;
  avatar: string;
  value: string;
}

export interface StageState {
  pin: string;
  gameTitle: string;
  phase: Phase;
  playerCount: number;
  /** lobby only, capped to the newest players */
  players: PlayerLite[];
  round: RoundInfo | null;
  question: QuestionPublic | null;
  answeredCount: number;
  reveal: RevealInfo | null;
  /** top 5, only in the leaderboard phase */
  leaderboard: LeaderRow[];
  /** top 3, only in the podium phase */
  podium: LeaderRow[];
  awards: Award[];
  isLastQuestion: boolean;
}

export interface PlayerResult {
  questionId: string;
  answered: boolean;
  /** null when the question has no right answer (poll) */
  correct: boolean | null;
  points: number;
  streak: number;
  responseMs: number | null;
}

export interface PlayerMe {
  id: string;
  nickname: string;
  avatar: string;
  score: number;
  rank: number | null;
  streak: number;
  gapToAbove: number | null;
  aboveNickname: string | null;
  totalPlayers: number;
}

export interface PlayerState {
  pin: string;
  gameTitle: string;
  phase: Phase;
  me: PlayerMe;
  round: RoundInfo | null;
  question: QuestionPublic | null;
  /** the choice this player sent for the current question */
  myAnswer: number | null;
  /** this player's result for the current question, after reveal */
  result: PlayerResult | null;
  correctChoices: number[] | null;
}

// ---------- Report ----------

export interface ReportQuestion {
  number: number;
  roundTitle: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  correct: number[];
  counts: number[];
  answered: number;
  correctCount: number;
  avgMs: number | null;
}

export interface ReportPlayer {
  rank: number;
  nickname: string;
  avatar: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  avgMs: number | null;
  bestStreak: number;
}

export interface GameReport {
  pin: string;
  gameTitle: string;
  startedAt: number | null;
  endedAt: number | null;
  playerCount: number;
  questions: ReportQuestion[];
  players: ReportPlayer[];
}
