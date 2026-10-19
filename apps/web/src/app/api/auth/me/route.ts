import { currentUser } from '@/server/auth';
import { authMode } from '@/server/config';
import { handle, json } from '@/server/http';
import { clearSessionCookie } from '@/server/session';

/** Which login mode the app runs in, and who is logged in (if anyone). */
export async function GET(req: Request) {
  return handle(async () => {
    const { user, clearCookie } = await currentUser(req);
    return json(
      { mode: authMode(), user: user && { id: user.id, name: user.name, isCurator: user.isCurator } },
      200,
      clearCookie ? { 'set-cookie': clearSessionCookie() } : {},
    );
  });
}
