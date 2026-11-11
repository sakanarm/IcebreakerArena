import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { closeExam, publishExam } from '@/server/exams';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { isId } from '@/server/session';

type Ctx = { params: Promise<{ id: string }> };

/** Opens the game's exam link, or updates the paper behind the one already open. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!isId(id)) throw new HttpError(404, 'not_found');
    const res = await publishExam(await getDb(), user, id);
    if (res.ok) return json({ link: res.link }, res.created ? 201 : 200);
    if (res.reason === 'invalid') throw new HttpError(422, 'invalid_game', { errors: res.errors.slice(0, 20) });
    const status = { not_found: 404, under_review: 409, no_questions: 422 }[res.reason];
    throw new HttpError(status, res.reason === 'no_questions' ? 'no_exam_questions' : res.reason);
  });
}

/** Closes the game's exam link. */
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    const { id } = await ctx.params;
    if (!isId(id) || !(await closeExam(await getDb(), user, id))) throw new HttpError(404, 'not_found');
    return json({ ok: true });
  });
}
