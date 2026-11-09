import { requireUser } from '@/server/auth';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { existingProject, searchPages } from '@/server/pika';

/** Pages in the person's own project that answer a question. A search changes nothing, but it
 * carries the question in a body rather than a url, so it never lands in a proxy log. */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
    const project = existingProject(user.email);
    if (!project) throw new HttpError(409, 'no_project');

    const body = await readJson(req, 4096);
    const query = (typeof body.query === 'string' ? body.query : '').trim().slice(0, 200);
    if (query.length < 2) throw new HttpError(400, 'bad_query');
    return json({ hits: await searchPages(project, query, 10) });
  });
}
