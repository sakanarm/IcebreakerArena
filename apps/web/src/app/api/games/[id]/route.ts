import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { deleteGame, getGame, normalizeDraft, saveGame } from '@/server/games';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { isId } from '@/server/session';

type Ctx = { params: Promise<{ id: string }> };

async function gameId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isId(id)) throw new HttpError(404, 'not_found');
  return id;
}

export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser(req);
    const game = await getGame(await getDb(), user.id, await gameId(ctx));
    if (!game) throw new HttpError(404, 'not_found');
    return json({ game });
  });
}

/** Saves a draft over the version the editor loaded; 409 when another tab or device saved first. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const id = await gameId(ctx);
    const body = await readJson(req);
    const draft = normalizeDraft(body.game);
    const version = body.version;
    // versions are int4 in the database; anything outside that range can't match a saved game
    if (!draft || typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 2147483647) throw new HttpError(400, 'bad_game');
    const res = await saveGame(await getDb(), user.id, id, draft, version);
    if (res.ok) return json({ version: res.version });
    if (res.reason === 'conflict') throw new HttpError(409, 'conflict', { version: res.version });
    throw new HttpError(404, 'not_found');
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const id = await gameId(ctx);
    const db = await getDb();
    if (!(await deleteGame(db, user.id, id))) throw new HttpError(404, 'not_found');
    await audit(db, user.id, 'game.delete', id);
    return json({ ok: true });
  });
}
