import type { Game, Question, Round } from './types';

/**
 * The game as a room is allowed to see it.
 *
 * A question built from a knowledge base keeps the page it came from (`source`) and an `explanation`
 * written out of that page. Neither may reach a room: the game server hands the game to the Host
 * screen, to the big screen and to every phone in the room, and the people in the room are not
 * necessarily members of the project that page lives in (ROADMAP 11.9). So this is the one place the
 * cut is made — `host:create` on the server and the Host page in the browser both go through it, and
 * no screen has to remember the rule for itself.
 *
 * An explanation someone typed has no `source` and stays: it is the sentence the reveal teaches with.
 */
export function toRoomGame(game: Game): Game {
  return { ...game, rounds: game.rounds.map((r) => ({ ...r, questions: r.questions.map(forRoom) })) };
}

function forRoom(q: Question): Question {
  if (!q.source) return q;
  const out = { ...q };
  delete out.source;
  delete out.explanation;
  return out;
}

/** whether a round is a question bank: it asks some of its questions, picked at random */
export const isBank = (round: Pick<Round, 'draw'>): boolean => typeof round.draw === 'number' && round.draw >= 1;

/** how many questions a room asks from a round: all of them, or a bank's draw (never more than it has) */
export function askedCount(round: Pick<Round, 'draw' | 'questions'>): number {
  const all = round.questions.length;
  return isBank(round) ? Math.min(Math.floor(round.draw!), all) : all;
}

/**
 * The game one room plays: every question bank cut down to the questions drawn for this room.
 *
 * Done once, on the server, when the room opens — so the Host screen, the big screen, every phone
 * and the report all see the same set, and nothing in a room needs to know the round was a bank.
 * A drawn question keeps its id, so a report still says which question of the bank it was.
 * `random` is Math.random's shape; a test passes its own to get the same draw twice.
 */
export function drawGame(game: Game, random: () => number = Math.random): Game {
  return {
    ...game,
    rounds: game.rounds.map((r) => {
      if (r.draw === undefined) return r;
      const { draw: _draw, ...rest } = r;
      return { ...rest, questions: pick(r.questions, askedCount(r), random) };
    }),
  };
}

/** n of the items, no item twice, in a random order (a Fisher–Yates shuffle that stops after n places) */
function pick<T>(items: readonly T[], n: number, random: () => number): T[] {
  const pool = [...items];
  for (let i = 0; i < n; i++) {
    const j = Math.min(pool.length - 1, i + Math.floor(random() * (pool.length - i)));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}
