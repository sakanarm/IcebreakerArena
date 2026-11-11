import { authMode } from '@/server/config';
import { getDb } from '@/server/db';
import { readExam } from '@/server/exams';
import { HttpError, handle, json } from '@/server/http';
import { isId } from '@/server/session';

/**
 * The paper behind an exam link. No account is needed: holding the link is what lets someone sit
 * the exam. Without accounts there is no database and so no links at all.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    if (authMode() === 'off') throw new HttpError(404, 'not_found');
    const { code } = await ctx.params;
    if (!isId(code)) throw new HttpError(404, 'not_found');
    const exam = await readExam(await getDb(), code);
    if (!exam) throw new HttpError(404, 'not_found');
    return json({ exam });
  });
}
