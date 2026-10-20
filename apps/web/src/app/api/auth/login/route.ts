import { startSession } from '@/server/auth';
import { authMode } from '@/server/config';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { LOCAL_ISSUER, checkLocalLogin } from '@/server/local-users';

/** Username and password login. Only exists when AUTH_MODE=local. */
export async function POST(req: Request) {
  return handle(async () => {
    if (authMode() !== 'local') throw new HttpError(404, 'not_found');
    guardMutation(req);
    const body = await readJson(req, 4096);
    // checked before the login transaction, so a failed try stays in the audit log
    const found = await checkLocalLogin(await getDb(), body.username, body.password);
    const { user, setCookie } = await startSession(req, LOCAL_ISSUER, async () => found);
    return json({ user: { id: user.id, name: user.name, isCurator: user.isCurator } }, 200, { 'set-cookie': setCookie });
  });
}
