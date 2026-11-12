import { refuseUselessPassword, resetPassword } from '@/server/admin';
import { requireAdmin } from '@/server/auth';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { isId } from '@/server/session';

/** A new generated password for a local account, shown to the admin once; the account is logged out everywhere. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    guardMutation(req);
    const admin = await requireAdmin(req);
    const { id } = await ctx.params;
    if (!isId(id)) throw new HttpError(404, 'not_found');
    refuseUselessPassword();
    return json(await resetPassword(await getDb(), admin, id));
  });
}
