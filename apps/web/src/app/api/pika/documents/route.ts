import { requirePerm, requireUser } from '@/server/auth';
import { HttpError, handle, json } from '@/server/http';
import { existingProject, listDocuments } from '@/server/pika';

const PAGE_SIZE = 50;

/** What is in the person's own project: one page of documents, with the wiki pages each became. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    requirePerm(user, 'pika');
    if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
    const project = existingProject(user.email);
    if (!project) throw new HttpError(409, 'no_project');

    const asked = Number(new URL(req.url).searchParams.get('offset') ?? 0);
    const offset = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 10_000) : 0;
    const { documents, total } = await listDocuments(project, { limit: PAGE_SIZE, offset });
    return json({ documents, total, offset, pageSize: PAGE_SIZE });
  });
}
