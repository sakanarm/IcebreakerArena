import { requireUser } from '@/server/auth';
import { REPORT_REASONS, reportEntry } from '@/server/catalog';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { isId } from '@/server/session';

/** Flags an entry: confidential content is hidden at once, until a curator looks. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!isId(id)) throw new HttpError(404, 'not_found');
    const body = await readJson(req, 4096);
    const reason = REPORT_REASONS.find((r) => r === body.reason);
    if (!reason) throw new HttpError(400, 'bad_reason');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const res = await reportEntry(await getDb(), user.id, id, reason, note);
    if (res.ok) return json({ hidden: res.hidden });
    throw new HttpError(res.reason === 'own_entry' ? 400 : 404, res.reason);
  });
}
