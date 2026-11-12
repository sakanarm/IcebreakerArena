import { requirePerm, requireUser } from '@/server/auth';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { ensureProject, existingProject, pikaConfigured } from '@/server/pika';

/** The email a project belongs to: a project is one person's, so an account without one can't have it. */
function emailOf(user: { email: string | null }): string {
  if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
  return user.email;
}

/** Whether this person has a knowledge base project yet, and whether one can be made at all. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    requirePerm(user, 'pika');
    const configured = pikaConfigured();
    const project = user.email?.includes('@') ? existingProject(user.email) : null;
    // the key itself never leaves the server
    return json({ configured, hasEmail: Boolean(user.email?.includes('@')), projectId: project?.projectId ?? null });
  });
}

/** Makes the person's project the first time they ask. Asking again hands back the one they have. */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    requirePerm(user, 'pika');
    const project = await ensureProject(emailOf(user), user.name);
    return json({ projectId: project.projectId }, 201);
  });
}
