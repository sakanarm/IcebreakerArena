import { logOut } from '@/server/auth';
import { guardMutation, handle, json } from '@/server/http';

export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    return json({ ok: true }, 200, { 'set-cookie': await logOut(req) });
  });
}
