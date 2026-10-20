import { audit } from './audit';
import { authMode } from './config';
import { getDb, type Sql } from './db';
import { HttpError } from './http';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  findSession,
  newId,
  pruneSessions,
  sessionCookie,
  sessionToken,
  type SessionUser,
} from './session';

export type { SessionUser };

/**
 * Who is calling. `clearCookie` is set when the browser sent a cookie we no longer accept,
 * so the response can drop it.
 */
export async function currentUser(req: Request): Promise<{ user: SessionUser | null; clearCookie: boolean }> {
  if (authMode() === 'off') return { user: null, clearCookie: false };
  const { token, duplicate } = sessionToken(req);
  if (duplicate) return { user: null, clearCookie: true };
  if (!token) return { user: null, clearCookie: false };
  const user = await findSession(await getDb(), token);
  return { user, clearCookie: !user };
}

/**
 * The logged-in user, or a refusal: 404 when accounts are off (the API does not exist), 401 otherwise.
 * A page sends X-IB-User, the user it opened as; when another login in the same browser has replaced
 * that session since, the request is refused (409 wrong_user) instead of acting on the other account.
 */
export async function requireUser(req: Request): Promise<SessionUser> {
  if (authMode() === 'off') throw new HttpError(404, 'not_found');
  const { user } = await currentUser(req);
  if (!user) throw new HttpError(401, 'login_required');
  const expected = req.headers.get('x-ib-user');
  if (expected && expected !== user.id) throw new HttpError(409, 'wrong_user');
  return user;
}

export interface Identity {
  /** who vouches for the person: 'mock', or the Entra tenant id */
  issuer: string;
  /** stable id from the issuer: the Entra object id, never the email or name */
  subject: string;
  name: string;
  email?: string | null;
}

/** Creates or updates the user, ends the session this browser had, and starts a new one (a fresh id at every login). */
export const logIn = (req: Request, identity: Identity) => startSession(req, identity.issuer, (sql) => upsertUser(sql, identity));

/** Logs in the user `pick` finds (or throws for), in place of the session this browser had. */
export async function startSession(
  req: Request,
  issuer: string,
  pick: (sql: Sql) => Promise<SessionUser>,
): Promise<{ user: SessionUser; setCookie: string }> {
  const db = await getDb();
  const { token: old } = sessionToken(req);
  const { user, token } = await db.tx(async (sql) => {
    const user = await pick(sql);
    if (old) await deleteSession(sql, old);
    const token = await createSession(sql, user.id);
    await sql.query('UPDATE ib_users SET last_login_at = now() WHERE id = $1', [user.id]);
    await audit(sql, user.id, 'login', null, { issuer });
    return { user, token };
  });
  await pruneSessions(db).catch((e) => console.error('[auth] prune sessions:', e));
  return { user, setCookie: sessionCookie(token) };
}

export async function logOut(req: Request): Promise<string> {
  const { token } = sessionToken(req);
  if (token && authMode() !== 'off') await deleteSession(await getDb(), token);
  return clearSessionCookie();
}

export async function upsertUser(sql: Sql, identity: Identity): Promise<SessionUser> {
  const rows = await sql.query<{ id: string; display_name: string; email: string | null; is_curator: boolean; disabled: boolean }>(
    `INSERT INTO ib_users (id, issuer, subject, display_name, email) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (issuer, subject) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, last_login_at = now()
     RETURNING id, display_name, email, is_curator, disabled`,
    [newId(), identity.issuer, identity.subject, identity.name, identity.email ?? null],
  );
  const u = rows[0]!;
  if (u.disabled) throw new HttpError(403, 'account_disabled');
  return { id: u.id, name: u.display_name, email: u.email, isCurator: u.is_curator };
}
