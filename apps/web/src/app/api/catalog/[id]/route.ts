import { requireUser } from '@/server/auth';
import { withdrawEntry } from '@/server/catalog';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { isId } from '@/server/session';

/** The author (or a curator) takes the entry out of the catalog. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!isId(id) || !(await withdrawEntry(await getDb(), user, id))) throw new HttpError(404, 'not_found');
    return json({ ok: true });
  });
}
