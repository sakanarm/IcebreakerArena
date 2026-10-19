import { requireUser } from '@/server/auth';
import { listCatalog, shareGame } from '@/server/catalog';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { isId } from '@/server/session';

/** The shared catalog, for anyone logged in. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    return json({ entries: await listCatalog(await getDb(), user.id) });
  });
}

/** Shares a frozen copy of one of your games. */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const body = await readJson(req, 4096);
    if (!isId(body.gameId)) throw new HttpError(404, 'not_found');
    const res = await shareGame(await getDb(), user, body.gameId);
    if (res.ok) return json({ entry: res.entry, replaced: res.replaced }, 201);
    if (res.reason === 'invalid') throw new HttpError(422, 'invalid_game', { errors: res.errors.slice(0, 20) });
    const status = { not_found: 404, tainted: 403, under_review: 409, too_many: 409 }[res.reason];
    throw new HttpError(status, res.reason);
  });
}
