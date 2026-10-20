import type { Game, Question, QuestionType, SliderSpec } from '@icebreaker/shared';

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

/** a new slider: 0–100 with the answer off-centre (the knob starts in the middle), near guesses still scoring */
export const NEW_SLIDER: SliderSpec = { min: 0, max: 100, step: 1, answer: 30, margin: 10 };

const pad = (texts: string[], n: number) => [...texts, ...Array<string>(Math.max(0, n - texts.length)).fill('')];

/** Switching type keeps what still makes sense: the prompt, the time, and the answers where they fit. */
export function retype(q: Question, type: QuestionType): Question {
  if (type === q.type) return q;
  const { slider: _slider, ...rest } = q;
  // what the author typed that can carry over: true/false and a slider have no texts of their own,
  // and a typed question's other spellings would only be near-copies of its main answer
  const texts = q.type === 'truefalse' || q.type === 'slider' ? [] : q.type === 'type' ? q.options.slice(0, 1) : q.options;
  switch (type) {
    case 'truefalse':
      return { ...rest, type, options: ['จริง', 'เท็จ'], correct: [q.correct[0] === 1 ? 1 : 0] };
    case 'slider':
      return { ...rest, type, options: [], correct: [], slider: { ...NEW_SLIDER } };
    case 'type': {
      // players type what the quiz had as its right answer
      const right = q.type === 'quiz' && q.correct.length > 0 ? (q.options[q.correct[0]!] ?? '') : '';
      return { ...rest, type, options: [right], correct: [] };
    }
    case 'puzzle':
      return { ...rest, type, options: texts.length >= 3 ? texts : pad(texts, 4), correct: [] };
    default:
      return { ...rest, type, options: texts.length >= 2 ? texts : pad(texts, 4), correct: type === 'poll' ? [] : [0] };
  }
}
