import { audit } from './audit';
import type { SessionUser } from './auth';
import { authMode, ssoAvailable } from './config';
import { lockWrites, type Db, type Sql } from './db';
import { HttpError } from './http';
import {
  LOCAL_ISSUER,
  cleanName,
  createLocalUser,
  generatePassword,
  hashPassword,
  setRoleColumns,
  setUserEmail,
} from './local-users';
import { PERMS, isRole, readPerms, storedPerms, type Perms, type Role } from './roles';

/**
 * The admin page's user list (app/admin): who has an account, what they may do, and the changes an
 * admin makes to them. Every change is logged with the admin who made it. Two rules keep the site
 * runnable: an admin can't demote or disable themself, and there is always at least one admin who
 * can log in. Nobody is deleted: an account that should stop is disabled, which ends its sessions
 * and keeps its games. Passwords are only ever made here (generated), shown once and stored hashed.
 */

export interface AdminUser {
  id: string;
  name: string;
  /** local: an account made here or with `npm run users` (password and/or company login by email); mock: development; sso: an older company-login row */
  kind: 'local' | 'mock' | 'sso';
  username: string | null;
  email: string | null;
  role: Role;
  can: Perms;
  disabled: boolean;
  hasPassword: boolean;
  createdAt: string;
  /** null when the account was made here and nobody has logged in to it yet */
  lastLoginAt: string | null;
  games: number;
}

type Row = {
  id: string;
  issuer: string;
  subject: string;
  display_name: string;
  email: string | null;
  role: string;
  perms: unknown;
  disabled: boolean;
  has_password: boolean;
  created_at: Date;
  last_login_at: Date;
  games: number;
};

const SELECT = `SELECT u.id, u.issuer, u.subject, u.display_name, u.email, u.role, u.perms, u.disabled,
    u.created_at, u.last_login_at, (p.user_id IS NOT NULL) AS has_password,
    (SELECT count(*)::int FROM ib_games g WHERE g.owner_id = u.id) AS games
  FROM ib_users u LEFT JOIN ib_passwords p ON p.user_id = u.id`;

function toAdminUser(r: Row): AdminUser {
  const kind = r.issuer === LOCAL_ISSUER ? 'local' : r.issuer === 'mock' ? 'mock' : 'sso';
  const iso = (d: Date) => new Date(d).toISOString();
  return {
    id: r.id,
    name: r.display_name,
    kind,
    username: kind === 'sso' ? null : r.subject,
    email: r.email,
    role: isRole(r.role) ? r.role : 'maker',
    can: readPerms(r.perms),
    disabled: r.disabled,
    hasPassword: r.has_password,
    createdAt: iso(r.created_at),
    // a local row is made with last_login_at = created_at, and every login after sets it again later
    lastLoginAt: kind === 'local' && iso(r.last_login_at) === iso(r.created_at) ? null : iso(r.last_login_at),
    games: Number(r.games) || 0,
  };
}

/**
 * How people can log in on this site right now, so the page offers only ways that work: a password
 * only when the password form is there (local mode; oidc has none), and an account without one only
 * makes sense once company login is set up (it can still be made ahead of that, and is told so).
 */
export function loginWays(): { passwords: boolean; company: boolean } {
  return { passwords: authMode() === 'local', company: ssoAvailable() };
}

/** A password made now could never be used: the site has no password form. */
export function refuseUselessPassword() {
  if (!loginWays().passwords) throw new HttpError(409, 'no_passwords');
}

export const ADMIN_LIST_MAX = 200;

/** Accounts newest first, at most 200, optionally those whose name, username or email holds `q`. */
export async function listUsers(sql: Sql, rawQ: unknown): Promise<{ users: AdminUser[]; total: number; matched: number }> {
  const q = typeof rawQ === 'string' ? rawQ.trim().toLowerCase().slice(0, 100) : '';
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = q ? `WHERE lower(u.display_name) LIKE $1 OR lower(u.subject) LIKE $1 OR lower(coalesce(u.email, '')) LIKE $1` : '';
  const params = q ? [like] : [];
  const rows = await sql.query<Row>(`${SELECT} ${where} ORDER BY u.created_at DESC, u.id LIMIT ${ADMIN_LIST_MAX}`, params);
  const total = await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM ib_users');
  const matched = q ? await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM ib_users u ${where}`, params) : total;
  return { users: rows.map(toAdminUser), total: Number(total[0]?.n ?? 0), matched: Number(matched[0]?.n ?? 0) };
}

async function getUser(sql: Sql, id: string): Promise<AdminUser> {
  const rows = await sql.query<Row>(`${SELECT} WHERE u.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'not_found');
  return toAdminUser(rows[0]);
}

const bad = (field: string) => new HttpError(400, 'bad_field', { field });

/** another admin who can still log in, besides `id` */
async function otherAdmins(sql: Sql, id: string): Promise<number> {
  const rows = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM ib_users WHERE role = 'admin' AND NOT disabled AND id <> $1", [id]);
  return Number(rows[0]?.n ?? 0);
}

export interface NewUser {
  username: string;
  name: string;
  /** generate: a password made now and shown once; none: company login only, by the email */
  password: 'generate' | 'none';
  email: string | null;
  role: Role;
}

export function readNewUser(body: Record<string, unknown>): NewUser {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : null);
  const username = str('username');
  const name = str('name');
  if (username === null) throw bad('username');
  if (name === null) throw bad('name');
  const password = body.password === 'none' ? 'none' : body.password === 'generate' ? 'generate' : null;
  if (!password) throw bad('password');
  const email = str('email')?.trim() || null;
  // without a password the only way in is the company login, which finds the account by its email
  if (password === 'none' && !email) throw bad('email');
  const role = body.role ?? 'maker';
  if (!isRole(role)) throw bad('role');
  return { username, name, password, email, role };
}

/** Makes a local account. The password, when one was made, is in the answer and nowhere else. */
export async function createUser(db: Db, actor: SessionUser, u: NewUser): Promise<{ user: AdminUser; password: string | null }> {
  const password = u.password === 'generate' ? generatePassword() : null;
  const id = await db.tx(async (sql) => {
    await lockWrites(sql);
    const made = await createLocalUser(sql, { username: u.username, name: u.name, password, role: u.role, actorId: actor.id });
    if (u.email) await setUserEmail(sql, made.id, u.email, actor.id);
    return made.id;
  });
  return { user: await getUser(db, id), password };
}

export interface UserPatch {
  role?: Role;
  can?: Partial<Perms>;
  disabled?: boolean;
  name?: string;
  email?: string | null;
}

export function readPatch(body: Record<string, unknown>): UserPatch {
  const p: UserPatch = {};
  if ('role' in body) {
    if (!isRole(body.role)) throw bad('role');
    p.role = body.role;
  }
  if ('can' in body) {
    const c = body.can;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('can');
    p.can = {};
    for (const [k, v] of Object.entries(c)) {
      if (!PERMS.includes(k as never) || typeof v !== 'boolean') throw bad('can');
      p.can[k as keyof Perms] = v;
    }
  }
  if ('disabled' in body) {
    if (typeof body.disabled !== 'boolean') throw bad('disabled');
    p.disabled = body.disabled;
  }
  if ('name' in body) {
    if (typeof body.name !== 'string') throw bad('name');
    p.name = body.name;
  }
  if ('email' in body) {
    if (body.email !== null && typeof body.email !== 'string') throw bad('email');
    p.email = body.email as string | null;
  }
  if (!Object.keys(p).length) throw bad('nothing');
  return p;
}

/** Applies an admin's change to one account, all or nothing. */
export async function updateUser(db: Db, actor: SessionUser, id: string, patch: UserPatch): Promise<AdminUser> {
  await db.tx(async (sql) => {
    await lockWrites(sql);
    const before = await getUser(sql, id);
    const demoted = patch.role !== undefined && before.role === 'admin' && patch.role !== 'admin';
    const disabling = patch.disabled === true && !before.disabled;
    if (id === actor.id && (demoted || disabling)) throw new HttpError(409, 'self_change');
    if (before.role === 'admin' && !before.disabled && (demoted || disabling) && (await otherAdmins(sql, id)) === 0) throw new HttpError(409, 'last_admin');
    // the company login keeps name and email of its own rows; ours are set here
    if ((patch.name !== undefined || patch.email !== undefined) && before.kind !== 'local') throw new HttpError(409, 'not_local');

    if (patch.role !== undefined && patch.role !== before.role) {
      await setRoleColumns(sql, id, patch.role);
      await audit(sql, actor.id, 'admin_role_set', id, { role: patch.role, was: before.role });
    }
    if (patch.can) {
      const can = { ...before.can, ...patch.can };
      if (PERMS.some((k) => can[k] !== before.can[k])) {
        const off = storedPerms(can);
        await sql.query('UPDATE ib_users SET perms = $2 WHERE id = $1', [id, JSON.stringify(off)]);
        await audit(sql, actor.id, 'admin_perms_set', id, { off: Object.keys(off) });
      }
    }
    if (patch.disabled !== undefined && patch.disabled !== before.disabled) {
      await sql.query('UPDATE ib_users SET disabled = $2 WHERE id = $1', [id, patch.disabled]);
      // logged out everywhere at once, not at their next request
      if (patch.disabled) await sql.query('DELETE FROM ib_sessions WHERE user_id = $1', [id]);
      await audit(sql, actor.id, patch.disabled ? 'admin_user_disabled' : 'admin_user_enabled', id);
    }
    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      if (name !== before.name) {
        await sql.query('UPDATE ib_users SET display_name = $2 WHERE id = $1', [id, name]);
        await audit(sql, actor.id, 'admin_name_set', id);
      }
    }
    if (patch.email !== undefined) {
      const email = patch.email?.trim().toLowerCase() || null;
      if (email !== before.email) await setUserEmail(sql, id, email, actor.id);
    }
  });
  return getUser(db, id);
}

/** A new generated password for a local account; every session it had ends. Shown once to the admin. */
export async function resetPassword(db: Db, actor: SessionUser, id: string): Promise<{ user: AdminUser; password: string }> {
  const password = generatePassword();
  const hash = await hashPassword(password);
  await db.tx(async (sql) => {
    await lockWrites(sql);
    const before = await getUser(sql, id);
    if (before.kind !== 'local') throw new HttpError(409, 'not_local');
    await sql.query(
      `INSERT INTO ib_passwords (user_id, hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`,
      [id, hash],
    );
    await sql.query('DELETE FROM ib_sessions WHERE user_id = $1', [id]);
    await audit(sql, actor.id, 'local_password_set', id, { by: 'admin' });
  });
  return { user: await getUser(db, id), password };
}

/** Logs the account out on every device, for a lost laptop or a password that leaked. */
export async function endSessions(db: Db, actor: SessionUser, id: string): Promise<number> {
  return db.tx(async (sql) => {
    await getUser(sql, id);
    const gone = await sql.query<{ user_id: string }>('DELETE FROM ib_sessions WHERE user_id = $1 RETURNING user_id', [id]);
    await audit(sql, actor.id, 'admin_sessions_ended', id, { count: gone.length });
    return gone.length;
  });
}

/** Numbers for the system tab. */
export async function siteCounts(sql: Sql) {
  const [r] = await sql.query<Record<string, number>>(
    `SELECT
       (SELECT count(*)::int FROM ib_users) AS users,
       (SELECT count(*)::int FROM ib_users WHERE disabled) AS disabled,
       (SELECT count(*)::int FROM ib_users WHERE role = 'admin' AND NOT disabled) AS admins,
       (SELECT count(*)::int FROM ib_users WHERE role = 'curator' AND NOT disabled) AS curators,
       (SELECT count(DISTINCT user_id)::int FROM ib_sessions WHERE expires_at > now()) AS signed_in,
       (SELECT count(*)::int FROM ib_games) AS games,
       (SELECT count(*)::int FROM ib_exams) AS exams,
       (SELECT count(*)::int FROM ib_catalog_entries WHERE status = 'listed') AS shared`,
  );
  return {
    users: Number(r?.users ?? 0),
    disabled: Number(r?.disabled ?? 0),
    admins: Number(r?.admins ?? 0),
    curators: Number(r?.curators ?? 0),
    signedIn: Number(r?.signed_in ?? 0),
    games: Number(r?.games ?? 0),
    exams: Number(r?.exams ?? 0),
    shared: Number(r?.shared ?? 0),
  };
}

/** What changed lately, for the system tab: who did what to whom, nothing more (the log holds no content). */
export async function recentChanges(sql: Sql, limit = 30) {
  const rows = await sql.query<{ at: Date; action: string; actor: string | null; target: string | null }>(
    `SELECT a.at, a.action, ua.display_name AS actor, ut.display_name AS target
       FROM ib_audit_log a
       LEFT JOIN ib_users ua ON ua.id = a.user_id
       LEFT JOIN ib_users ut ON ut.id = a.target
      WHERE a.action LIKE 'admin\\_%' OR a.action IN ('local_user_created', 'local_password_set', 'local_email_set', 'ai_settings_saved')
      ORDER BY a.at DESC, a.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ at: new Date(r.at).toISOString(), action: r.action, actor: r.actor, target: r.target }));
}
