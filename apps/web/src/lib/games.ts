import { SAMPLE_GAMES, copyTitle, leadInMs, type Game, type Question, type Round } from '@icebreaker/shared';
import { keys, load, save } from './storage';

/** Games made in the editor live in this browser until the Phase 2 database arrives. */
export function listMyGames(): Game[] {
  const games = load<Game[]>(keys.myGames, []);
  return Array.isArray(games) ? games : [];
}

export function saveMyGame(game: Game) {
  const games = listMyGames();
  const i = games.findIndex((g) => g.id === game.id);
  if (i >= 0) games[i] = game;
  else games.unshift(game);
  save(keys.myGames, games);
}

export function deleteMyGame(id: string) {
  save(
    keys.myGames,
    listMyGames().filter((g) => g.id !== id),
  );
}

export function findGame(id: string): Game | undefined {
  return listMyGames().find((g) => g.id === id) ?? SAMPLE_GAMES.find((g) => g.id === id);
}

export const isSample = (id: string) => SAMPLE_GAMES.some((g) => g.id === id);

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function blankQuestion(): Question {
  return { id: newId('q'), type: 'quiz', prompt: '', options: ['', '', '', ''], correct: [0], timeLimitS: 20 };
}

export function blankRound(n: number): Round {
  return { id: newId('r'), title: `ด่านที่ ${n}`, questions: [blankQuestion()] };
}

export function blankGame(): Game {
  return { id: newId('g'), title: '', description: '', rounds: [blankRound(1)], settings: { streakBonus: false } };
}

/** A sample becomes an editable copy with fresh ids, so the original stays intact. */
export function copyGame(game: Game): Game {
  const copy = structuredClone(game);
  copy.id = newId('g');
  copy.title = copyTitle(game.title);
  return copy;
}

export function countQuestions(game: Game) {
  return game.rounds.reduce((n, r) => n + r.questions.length, 0);
}

/**
 * Blank 3rd / 4th answers are unused slots in the editor (as in Kahoot): drop them before
 * checking or playing. A blank answer that is marked correct stays, so the check can flag it.
 */
export function dropBlankOptions(game: Game): Game {
  return {
    ...game,
    rounds: game.rounds.map((r) => ({
      ...r,
      questions: r.questions.map((q) => {
        if (q.type === 'truefalse') return q;
        const keep = q.options.map((o, i) => i < 2 || o.trim() !== '' || q.correct.includes(i));
        if (keep.every(Boolean)) return q;
        const moved = new Map<number, number>();
        const options: string[] = [];
        q.options.forEach((o, i) => {
          if (!keep[i]) return;
          moved.set(i, options.length);
          options.push(o);
        });
        return { ...q, options, correct: q.correct.filter((c) => moved.has(c)).map((c) => moved.get(c)!) };
      }),
    })),
  };
}

/** Rough minutes for a live game: lead-in + answer time + about 10 s of reveal and ranking per question. */
export function estimateMinutes(game: Game): number {
  let ms = 0;
  for (const r of game.rounds) {
    ms += 3500;
    for (const q of r.questions) ms += leadInMs(q.prompt) + q.timeLimitS * 1000 + 10_000;
  }
  return Math.max(1, Math.round(ms / 60_000));
}
