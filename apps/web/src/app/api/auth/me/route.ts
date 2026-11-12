import { publicUser } from '@/server/roles';
import { currentUser } from '@/server/auth';
import { authMode, ssoAvailable } from '@/server/config';
import { handle, json } from '@/server/http';
import { clearSessionCookie } from '@/server/session';

/** Which login mode the app runs in, whether company login is offered, and who is logged in (if anyone). */
export async function GET(req: Request) {
  return handle(async () => {
    const { user, clearCookie } = await currentUser(req);
    return json(
      { mode: authMode(), sso: ssoAvailable(), user: user && publicUser(user) },
      200,
      clearCookie ? { 'set-cookie': clearSessionCookie() } : {},
    );
  });
}
