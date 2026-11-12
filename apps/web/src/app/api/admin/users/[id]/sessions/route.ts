import { endSessions } from '@/server/admin';
import { requireAdmin } from '@/server/auth';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { isId } from '@/server/session';

/** Logs one account out on every device. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    guardMutation(req);
    const admin = await requireAdmin(req);
    const { id } = await ctx.params;
    if (!isId(id)) throw new HttpError(404, 'not_found');
    return json({ ended: await endSessions(await getDb(), admin, id) });
  });
}
