import { createUser, listUsers, loginWays, readNewUser, refuseUselessPassword } from '@/server/admin';
import { requireAdmin } from '@/server/auth';
import { getDb } from '@/server/db';
import { guardMutation, handle, json, readJson } from '@/server/http';

/** GET ?q=: the accounts (newest first, at most 200) and how people can log in. POST: make a local account (server/admin.ts). */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const q = new URL(req.url).searchParams.get('q');
    return json({ ...(await listUsers(await getDb(), q)), login: loginWays() });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const admin = await requireAdmin(req);
    const body = readNewUser(await readJson(req, 4096));
    if (body.password === 'generate') refuseUselessPassword();
    return json(await createUser(await getDb(), admin, body), 201);
  });
}
