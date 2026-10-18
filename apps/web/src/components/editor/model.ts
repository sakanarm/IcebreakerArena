import type { Game, Question, QuestionType } from '@icebreaker/shared';

export type Selection = { kind: 'game' } | { kind: 'round'; id: string } | { kind: 'question'; id: string };

/** Every change goes through here: it receives a copy of the game to change in place. */
export type Edit = (mutate: (draft: Game) => void) => void;

export function findRound(game: Game, id: string) {
  const ri = game.rounds.findIndex((r) => r.id === id);
  return ri < 0 ? null : { ri, round: game.rounds[ri] };
}

export function findQuestion(game: Game, id: string) {
  for (let ri = 0; ri < game.rounds.length; ri++) {
    const qi = game.rounds[ri].questions.findIndex((q) => q.id === id);
    if (qi >= 0) return { ri, qi, round: game.rounds[ri], question: game.rounds[ri].questions[qi] };
  }
  return null;
}

/**
 * validateGame() prefixes its messages with "ด่าน 2: …" or "ด่าน 2 ข้อ 3: …";
 * the prefix tells the editor where to show each problem.
 */
export function issuesAt(errors: string[], ri: number, qi?: number): string[] {
  const prefix = qi === undefined ? `ด่าน ${ri + 1}: ` : `ด่าน ${ri + 1} ข้อ ${qi + 1}: `;
  return errors.filter((e) => e.startsWith(prefix)).map((e) => e.slice(prefix.length));
}

export const gameIssues = (errors: string[]) => errors.filter((e) => !e.startsWith('ด่าน '));

/** Where a problem lives, so clicking it in the list jumps there. */
export function selectionFor(game: Game, error: string): Selection {
  const m = /^ด่าน (\d+)(?: ข้อ (\d+))?: /.exec(error);
  const round = m ? game.rounds[Number(m[1]) - 1] : undefined;
  if (!round) return { kind: 'game' };
  const question = m?.[2] ? round.questions[Number(m[2]) - 1] : undefined;
  return question ? { kind: 'question', id: question.id } : { kind: 'round', id: round.id };
}

/** Switching type keeps what still makes sense: the prompt, the time, and the answers where they fit. */
export function retype(q: Question, type: QuestionType): Question {
  if (type === q.type) return q;
  if (type === 'truefalse') return { ...q, type, options: ['จริง', 'เท็จ'], correct: [q.correct[0] === 1 ? 1 : 0] };
  const options = q.type === 'truefalse' ? ['', '', '', ''] : q.options;
  return { ...q, type, options, correct: type === 'poll' ? [] : [0] };
}
