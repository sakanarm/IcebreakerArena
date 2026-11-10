import type { Game, Question } from './types';

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
