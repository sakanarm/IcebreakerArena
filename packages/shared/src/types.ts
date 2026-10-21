import type { CoverArt, CoverColor } from './cover';

// ---------- Game content (what a Host authors) ----------

/**
 * quiz / truefalse / poll: tap one of the tiles.
 * puzzle: put the items in the right order. type: type the answer. slider: guess a number.
 */
export type QuestionType = 'quiz' | 'truefalse' | 'poll' | 'puzzle' | 'type' | 'slider';

/** A slider question's scale and answer. Whole numbers only, so "exactly right" means what it says. */
export interface SliderSpec {
  min: number;
  max: number;
  step: number;
  answer: number;
  /** guesses this far from the answer still score, less the further off; 0 = exact only */
  margin: number;
  /** shown after the number, e.g. "ปี" or "เมตร" */
  unit?: string;
}

/** 0 = no points, 1 = standard, 2 = double points */
export type QuestionMultiplier = 0 | 1 | 2;

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  /**
   * quiz / poll: 2–4 options; truefalse: exactly 2.
   * puzzle: 3–4 items in the right order (players see them shuffled).
   * type: 1–4 accepted answers. slider: empty.
   */
  options: string[];
  /** indices of the correct options; empty for every type but quiz and truefalse */
  correct: number[];
  timeLimitS: number;
  multiplier?: QuestionMultiplier;
  imageUrl?: string;
  /** slider only */
  slider?: SliderSpec;
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

/**
 * How the game's cover looks. Without a picture it is a pattern drawn from the title, in the
 * color picked (or one that comes from the title), with the emoji in the middle.
 */
export interface GameCover {
  color?: CoverColor;
  /** a single emoji */
  emoji?: string;
  /** a drawn picture instead of the pattern */
  art?: CoverArt;
}

export interface Game {
  id: string;
  title: string;
  description?: string;
  rounds: Round[];
  settings?: GameSettings;
  cover?: GameCover;
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
  /** puzzle: shuffled, the same for everyone; type and slider: empty, so nothing gives the answer away */
  options: string[];
  /** slider: the scale, without the answer */
  slider?: Omit<SliderSpec, 'answer' | 'margin'>;
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

/** The answer to a question that isn't a pick from the tiles, sent once answering has closed. */
export interface AnswerKey {
  /** puzzle: the items in the right order; type: every accepted answer */
  texts?: string[];
  /** slider */
  answer?: number;
  margin?: number;
}

/** What a player sent: the one field that fits the question type. */
export interface AnswerSent {
  /** quiz, truefalse, poll: the tile */
  choice?: number;
  /** puzzle: indices into the shuffled options, first to last */
  order?: number[];
  /** type */
  text?: string;
  /** slider */
  value?: number;
}

export interface RevealInfo {
  /** tiles that were right (quiz, truefalse); empty for every other type */
  correct: number[];
  /**
   * quiz / truefalse / poll: votes per tile. type: players per accepted answer.
   * slider: guesses per stretch of the scale (see sliderBins). puzzle: empty.
   */
  counts: number[];
  key?: AnswerKey;
  /** slider: the average guess */
  average?: number | null;
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
  /** for the lobby; null when the game has none, so it gets the pattern made from its title */
  cover: GameCover | null;
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
  /** goes up by one at every change of phase: the host's Next carries the one it was pressed on (see `host:next`) */
  step: number;
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
  /** what this player sent for the current question */
  myAnswer: AnswerSent | null;
  /** this player's result for the current question, after reveal */
  result: PlayerResult | null;
  correctChoices: number[] | null;
  /** after reveal, for puzzle, type and slider */
  key: AnswerKey | null;
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
  slider?: SliderSpec;
  /** slider: the average guess */
  average?: number | null;
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
  /** questions with a right answer (not polls) the player was in the game for, answered or not */
  gradedCount: number;
  /** every answer sent, polls included */
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
