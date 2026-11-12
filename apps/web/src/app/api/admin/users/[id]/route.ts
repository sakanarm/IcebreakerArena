import { readPatch, updateUser } from '@/server/admin';
import { requireAdmin } from '@/server/auth';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { isId } from '@/server/session';

/** Changes one account: role, permissions, disabled, and for local accounts name and email. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    guardMutation(req);
    const admin = await requireAdmin(req);
    const { id } = await ctx.params;
    if (!isId(id)) throw new HttpError(404, 'not_found');
    const patch = readPatch(await readJson(req, 4096));
    return json({ user: await updateUser(await getDb(), admin, id, patch) });
  });
}
