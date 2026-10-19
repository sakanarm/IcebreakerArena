import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { TooManyGames, findLocalGame, importLocalGame, normalizeDraft } from '@/server/games';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';

const LOCAL_ID = /^[\w-]{1,64}$/;

/** The saved game a browser game was moved into, for an old /editor?id=g-… link. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const localId = new URL(req.url).searchParams.get('localId') ?? '';
    const id = LOCAL_ID.test(localId) ? await findLocalGame(await getDb(), user.id, localId) : null;
    if (!id) throw new HttpError(404, 'not_found');
    return json({ id });
  });
}

/** One game kept in this browser, moved into the account. Safe to repeat: the same browser game maps to the same saved game. */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const body = await readJson(req);
    const draft = normalizeDraft(body.game);
    const localId = typeof body.localId === 'string' && LOCAL_ID.test(body.localId) ? body.localId : null;
    if (!draft || !localId) throw new HttpError(400, 'bad_game');
    try {
      return json(await importLocalGame(await getDb(), user.id, localId, draft));
    } catch (e) {
      if (e instanceof TooManyGames) throw new HttpError(409, 'too_many_games');
      throw e;
    }
  });
}
