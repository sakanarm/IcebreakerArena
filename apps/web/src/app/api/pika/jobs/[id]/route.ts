import { requirePerm, requireUser } from '@/server/auth';
import { HttpError, handle, json } from '@/server/http';
import { existingProject, getJob } from '@/server/pika';

/** How far a document the person sent has got: still being read, done (with its pages), or failed. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    requirePerm(user, 'pika');
    if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
    const project = existingProject(user.email);
    if (!project) throw new HttpError(409, 'no_project');

    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) throw new HttpError(400, 'bad_request');
    return json({ job: await getJob(project, id) });
  });
}
