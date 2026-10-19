import { logIn } from '@/server/auth';
import { authMode } from '@/server/config';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';

/** Development login: a name, no password. Only exists when AUTH_MODE=mock, which production refuses. */
export async function POST(req: Request) {
  return handle(async () => {
    if (authMode() !== 'mock') throw new HttpError(404, 'not_found');
    guardMutation(req);
    const body = await readJson(req, 4096);
    const name = typeof body.name === 'string' ? body.name.normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 40) throw new HttpError(400, 'bad_name');
    const { user, setCookie } = await logIn(req, { issuer: 'mock', subject: name.toLowerCase(), name });
    return json({ user: { id: user.id, name: user.name, isCurator: user.isCurator } }, 200, { 'set-cookie': setCookie });
  });
}
