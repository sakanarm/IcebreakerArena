import { createHash, randomBytes } from 'node:crypto';
import { basePath, secureCookies } from './config';
import type { Sql } from './db';

/** 128-bit random ids for users, games and catalog entries: nobody can guess someone else's */
export const newId = () => randomBytes(16).toString('base64url');
export const isId = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{22}$/.test(s);

export const IDLE_MS = 8 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often, not on every request */
const TOUCH_MS = 5 * 60 * 1000;

const isToken = (s: string) => /^[\w-]{43}$/.test(s);
/** the database keeps only a hash, so a leaked table can't be replayed as cookies */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  isCurator: boolean;
}

export async function createSession(sql: Sql, userId: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await sql.query('INSERT INTO ib_sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $3, $4)', [
    hashToken(token),
    userId,
    now,
    new Date(now.getTime() + ABSOLUTE_MS),
  ]);
  return token;
}

/** The logged-in user for a session token, or null when it is unknown, idle too long, past 7 days, or the user is disabled. */
export async function findSession(sql: Sql, token: string, now = new Date()): Promise<SessionUser | null> {
  if (!isToken(token)) return null;
  const idHash = hashToken(token);
  const rows = await sql.query<{
    last_seen_at: Date;
    expires_at: Date;
    id: string;
    display_name: string;
    email: string | null;
    is_curator: boolean;
    disabled: boolean;
  }>(
    `SELECT s.last_seen_at, s.expires_at, u.id, u.display_name, u.email, u.is_curator, u.disabled
       FROM ib_sessions s JOIN ib_users u ON u.id = s.user_id WHERE s.id_hash = $1`,
    [idHash],
  );
  const s = rows[0];
  if (!s) return null;
  const t = now.getTime();
  if (s.disabled || t >= s.expires_at.getTime() || t - s.last_seen_at.getTime() >= IDLE_MS) {
    await sql.query('DELETE FROM ib_sessions WHERE id_hash = $1', [idHash]);
    return null;
  }
  if (t - s.last_seen_at.getTime() >= TOUCH_MS) await sql.query('UPDATE ib_sessions SET last_seen_at = $2 WHERE id_hash = $1', [idHash, now]);
  return { id: s.id, name: s.display_name, email: s.email, isCurator: s.is_curator };
}

export async function deleteSession(sql: Sql, token: string) {
  if (isToken(token)) await sql.query('DELETE FROM ib_sessions WHERE id_hash = $1', [hashToken(token)]);
}

export async function pruneSessions(sql: Sql, now = new Date()) {
  await sql.query('DELETE FROM ib_sessions WHERE expires_at <= $1 OR last_seen_at <= $2', [now, new Date(now.getTime() - IDLE_MS)]);
}

// ---------- cookie ----------

export const sessionCookieName = () => (secureCookies() ? '__Secure-ib_sid' : 'ib_sid');

/** All values per cookie name. Next's cookie helpers keep only one, which would hide a planted duplicate. */
export function parseCookies(header: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

/**
 * The session token from the request. Two cookies with our name mean another app on the same
 * host set one (the path is not a wall): trust neither, the user is logged out.
 */
export function sessionToken(req: Request): { token: string | null; duplicate: boolean } {
  const values = parseCookies(req.headers.get('cookie')).get(sessionCookieName()) ?? [];
  if (values.length > 1) return { token: null, duplicate: true };
  return { token: values[0] || null, duplicate: false };
}

function cookie(value: string, maxAgeS: number) {
  const attrs = [`${sessionCookieName()}=${value}`, `Path=${basePath() || '/'}`, `Max-Age=${maxAgeS}`, 'HttpOnly', 'SameSite=Lax'];
  if (secureCookies()) attrs.push('Secure');
  return attrs.join('; ');
}

export const sessionCookie = (token: string) => cookie(token, Math.floor(ABSOLUTE_MS / 1000));
export const clearSessionCookie = () => cookie('', 0);
