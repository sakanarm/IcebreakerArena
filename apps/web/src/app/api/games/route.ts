import { SAMPLE_GAMES } from '@icebreaker/shared';
import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { TooManyGames, createGame, listGames, normalizeDraft } from '@/server/games';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';

/** The caller's own games. Nobody else's are ever listed. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    return json({ games: await listGames(await getDb(), user.id) });
  });
}

/** A new game: blank, a copy of a built-in sample, or an imported JSON file. */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const body = await readJson(req);
    const draft = normalizeDraft(body.game);
    if (!draft) throw new HttpError(400, 'bad_game');
    const sample = typeof body.sampleId === 'string' ? SAMPLE_GAMES.find((g) => g.id === body.sampleId) : undefined;
    const origin = sample ? 'sample' : body.from === 'import' ? 'import' : 'new';
    try {
      return json({ game: await createGame(await getDb(), user.id, draft, origin, sample?.id ?? null) }, 201);
    } catch (e) {
      if (e instanceof TooManyGames) throw new HttpError(409, 'too_many_games');
      throw e;
    }
  });
}
