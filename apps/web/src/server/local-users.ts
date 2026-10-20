import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { audit } from './audit';
import { upsertUser, type SessionUser } from './auth';
import type { Sql } from './db';
import { HttpError } from './http';

/**
 * Local accounts (AUTH_MODE=local): a username and password kept in our own database, until company
 * login (Entra) is ready. An admin makes the accounts with `npm run users`; nobody signs up alone.
 * They are ordinary ib_users rows with issuer 'local' and the username as subject, so moving to
 * company login later only adds a way in.
 */
export const LOCAL_ISSUER = 'local';

/** 3–32 of a–z, 0–9, dot, dash, underscore; typed in any case, kept lowercase */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(u) ? u : null;
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

// scrypt at N=2^15: about 100 ms a try on the server, 32 MiB of memory
const PARAMS = { N: 32768, r: 8, p: 1 };
const KEY_BYTES = 32;

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (e, key) => (e ? reject(e) : resolve(key))));
// At most 2 hashes at once: scrypt runs on Node's small shared thread pool, which also reads files, so a
// flood of logins must not take all of it. Past 100 waiting, refuse at once instead of queueing for ever.
const MAX_HASHING = 2;
const MAX_WAITING = 100;
let hashing = 0;
const waiting: (() => void)[] = [];
async function gated<T>(fn: () => Promise<T>): Promise<T> {
  if (hashing < MAX_HASHING) hashing++;
  else if (waiting.length >= MAX_WAITING) throw new HttpError(503, 'busy');
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await fn();
  } finally {
    // hand the slot straight to the next in line, so a newcomer can't slip in between
    const next = waiting.shift();
    if (next) next();
    else hashing--;
  }
}

const derive = (password: string, salt: Buffer, p: typeof PARAMS) =>
  gated(() => scrypt(password.normalize('NFC'), salt, KEY_BYTES, { ...p, maxmem: 128 * p.N * p.r * 2 }));

/** `scrypt$N$r$p$salt$key`, salt and key in base64url */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64url');
  const got = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A password to hand out once: 16 characters, about 95 bits, nothing that reads as another letter */
export function generatePassword(length = 16): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  // rejection sampling keeps every letter equally likely
  while (out.length < length) for (const b of randomBytes(length)) if (b < 216 && out.length < length) out += alphabet[b % alphabet.length];
  return out;
}

function checkPassword(password: string) {
  if ([...password].length < PASSWORD_MIN) throw new HttpError(400, 'password_too_short');
  if (password.length > PASSWORD_MAX) throw new HttpError(400, 'too_long');
}

/** Makes a local account, or refuses when the username is taken. */
export async function createLocalUser(
  sql: Sql,
  opts: { username: string; name: string; password: string; curator?: boolean },
): Promise<SessionUser> {
  const username = normalizeUsername(opts.username);
  if (!username) throw new HttpError(400, 'bad_username');
  const name = opts.name.normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'bad_name');
  checkPassword(opts.password);
  const taken = await sql.query('SELECT 1 FROM ib_users WHERE issuer = $1 AND subject = $2', [LOCAL_ISSUER, username]);
  if (taken.length) throw new HttpError(409, 'username_taken');
  const user = await upsertUser(sql, { issuer: LOCAL_ISSUER, subject: username, name });
  if (opts.curator) await sql.query('UPDATE ib_users SET is_curator = true WHERE id = $1', [user.id]);
  await sql.query('INSERT INTO ib_passwords (user_id, hash) VALUES ($1, $2)', [user.id, await hashPassword(opts.password)]);
  await audit(sql, null, 'local_user_created', user.id, { username, curator: !!opts.curator });
  return { ...user, isCurator: !!opts.curator };
}

/** Sets a new password and ends every session the account had. False when there is no such account. */
export async function setLocalPassword(sql: Sql, username: string, password: string): Promise<boolean> {
  checkPassword(password);
  const rows = await sql.query<{ id: string }>('SELECT id FROM ib_users WHERE issuer = $1 AND subject = $2', [LOCAL_ISSUER, normalizeUsername(username)]);
  const id = rows[0]?.id;
  if (!id) return false;
  await sql.query(
    `INSERT INTO ib_passwords (user_id, hash) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`,
    [id, await hashPassword(password)],
  );
  await sql.query('DELETE FROM ib_sessions WHERE user_id = $1', [id]);
  await audit(sql, null, 'local_password_set', id);
  return true;
}

// failed tries per username, in this process (the web app runs as one): 5 within 15 minutes, then wait
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; since: number }>();

function tooManyTries(username: string, now: number): boolean {
  const f = fails.get(username);
  if (f && now - f.since > WINDOW_MS) fails.delete(username);
  return (fails.get(username)?.count ?? 0) >= MAX_FAILS;
}

function noteFail(username: string, now: number) {
  const f = fails.get(username);
  if (f && now - f.since <= WINDOW_MS) f.count++;
  else fails.set(username, { count: 1, since: now });
  // the map can't grow without end under a spray of made-up names
  if (fails.size > 10_000) for (const [k, v] of fails) if (now - v.since > WINDOW_MS) fails.delete(k);
}

/** For tests: forget the failed tries. */
export const resetLoginThrottle = () => fails.clear();

// checked against when the username doesn't exist, so a wrong name takes as long as a wrong password
let decoy: Promise<string> | null = null;

/**
 * The user for a username and password. A wrong username and a wrong password get the same answer
 * (401 bad_login), so the login form can't be used to find out who has an account.
 */
export async function checkLocalLogin(sql: Sql, rawUsername: unknown, rawPassword: unknown, now = Date.now()): Promise<SessionUser> {
  const username = normalizeUsername(rawUsername);
  const password = typeof rawPassword === 'string' ? rawPassword : '';
  if (!username || !password || password.length > PASSWORD_MAX) throw new HttpError(401, 'bad_login');
  if (tooManyTries(username, now)) throw new HttpError(429, 'too_many_tries');
  const rows = await sql.query<{ id: string; display_name: string; email: string | null; is_curator: boolean; disabled: boolean; hash: string }>(
    `SELECT u.id, u.display_name, u.email, u.is_curator, u.disabled, p.hash
       FROM ib_users u JOIN ib_passwords p ON p.user_id = u.id
      WHERE u.issuer = $1 AND u.subject = $2`,
    [LOCAL_ISSUER, username],
  );
  const u = rows[0];
  decoy ??= hashPassword(generatePassword());
  const ok = await verifyPassword(password, u?.hash ?? (await decoy));
  if (!u || !ok) {
    noteFail(username, now);
    if (u) await audit(sql, u.id, 'login_failed', null, { issuer: LOCAL_ISSUER });
    throw new HttpError(401, 'bad_login');
  }
  fails.delete(username);
  if (u.disabled) throw new HttpError(403, 'account_disabled');
  return { id: u.id, name: u.display_name, email: u.email, isCurator: u.is_curator };
}
