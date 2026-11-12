import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature, type KeyObject } from 'node:crypto';

/** One public key from Keycloak's list (only the fields we read are typed). */
export type Jwk = { kty?: string; use?: string; alg?: string; crv?: string; kid?: string; d?: string; [k: string]: unknown };
import { basePath, secureCookies, type SsoConfig } from './config';
import type { Sql } from './db';
import { HttpError } from './http';
import { USER_COLUMNS, toSessionUser, type UserRow } from './roles';
import { parseCookies, type SessionUser } from './session';

/**
 * Company login through Keycloak (OpenID Connect, authorization code with PKCE). Keycloak, and
 * Microsoft behind it, only say who the person is; whether they may make games is ours to decide:
 * their email must belong to an account in ib_users (findSsoUser). Without that check everyone in
 * the company could log in. Players never log in.
 */

export const SSO_ISSUER = 'keycloak';
/** where Keycloak sends people back; registered in the Keycloak client exactly like this */
export const CALLBACK_PATH = '/api/auth/callback/keycloak';
const FLOW_MAX_AGE_S = 10 * 60;
const HINT_MAX_AGE_S = 7 * 24 * 60 * 60;
const TIMEOUT_MS = 10_000;

/** A login that went wrong somewhere between us and Keycloak: the page says "try again", the log says why. */
export class SsoError extends Error {}

const b64url = (b: Buffer) => b.toString('base64url');
const random = () => b64url(randomBytes(32));

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The site people use: appUrl in production, the address the browser used on a laptop. */
export function appOrigin(req: Request, cfg: SsoConfig): string {
  return cfg.appUrl ?? new URL(req.url).origin;
}

export const redirectUri = (req: Request, cfg: SsoConfig) => `${appOrigin(req, cfg)}${basePath()}${CALLBACK_PATH}`;

// ---------- the login in progress, kept in a short cookie ----------

export interface Flow {
  state: string;
  nonce: string;
  /** PKCE: only its hash goes to Keycloak, so a stolen code is no use without this */
  verifier: string;
  /** the page to land on, a path inside the app */
  next: string;
  at: number;
}

export const flowCookieName = () => (secureCookies() ? '__Secure-ib_sso' : 'ib_sso');
export const hintCookieName = () => (secureCookies() ? '__Secure-ib_sso_hint' : 'ib_sso_hint');

function cookie(name: string, value: string, maxAgeS: number) {
  const attrs = [`${name}=${value}`, `Path=${basePath()}/api/auth`, `Max-Age=${maxAgeS}`, 'HttpOnly', 'SameSite=Lax'];
  if (secureCookies()) attrs.push('Secure');
  return attrs.join('; ');
}

// Signed with a key only this app has: other apps on the same host can set cookies for our path,
// and an unsigned one would let them start a login that ends in their account (login CSRF).
const flowKey = (cfg: SsoConfig) => createHmac('sha256', cfg.clientSecret).update('ib-sso-flow-v1').digest();

export function sealFlow(cfg: SsoConfig, flow: Flow): string {
  const body = b64url(Buffer.from(JSON.stringify(flow)));
  return `${body}.${b64url(createHmac('sha256', flowKey(cfg)).update(body).digest())}`;
}

export function openFlow(cfg: SsoConfig, value: string | null, now = Date.now()): Flow | null {
  if (!value || value.length > 4096) return null;
  const [body, mac, extra] = value.split('.');
  if (!body || !mac || extra !== undefined) return null;
  if (!sameText(mac, b64url(createHmac('sha256', flowKey(cfg)).update(body).digest()))) return null;
  let f: Partial<Flow>;
  try {
    f = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof f.state !== 'string' || typeof f.nonce !== 'string' || typeof f.verifier !== 'string' || typeof f.next !== 'string' || typeof f.at !== 'number') return null;
  const age = now - f.at;
  if (age < -60_000 || age > FLOW_MAX_AGE_S * 1000) return null;
  return f as Flow;
}

export function newFlow(next: string, now = Date.now()): Flow {
  return { state: random(), nonce: random(), verifier: random(), next, at: now };
}

export const flowCookie = (cfg: SsoConfig, flow: Flow) => cookie(flowCookieName(), sealFlow(cfg, flow), FLOW_MAX_AGE_S);
export const clearFlowCookie = () => cookie(flowCookieName(), '', 0);
/** The ID token, kept so "use another account" can log out of Keycloak without its confirm page. */
export const hintCookie = (idToken: string) => (idToken.length <= 3500 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(idToken) ? cookie(hintCookieName(), idToken, HINT_MAX_AGE_S) : clearHintCookie());
export const clearHintCookie = () => cookie(hintCookieName(), '', 0);

/** One value for the cookie, or null (none, or two: one of them was planted). */
export function oneCookie(req: Request, name: string): string | null {
  const values = parseCookies(req.headers.get('cookie')).get(name) ?? [];
  return values.length === 1 && values[0] ? values[0] : null;
}

// ---------- what Keycloak publishes about itself ----------

export interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
let discovered: { issuer: string; at: number; doc: Discovery } | null = null;

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new SsoError(`${new URL(url).pathname}: ${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: the status says enough
  }
  return { status: res.status, body };
}

/** An endpoint Keycloak named, on the same scheme and host as the issuer: we never send the secret elsewhere. */
function endpoint(issuer: string, raw: unknown, what: string): string {
  try {
    const url = new URL(String(raw));
    if (url.origin === new URL(issuer).origin) return url.href;
  } catch {
    // falls through
  }
  throw new SsoError(`discovery: ${what} is missing or on another host`);
}

export async function discover(cfg: SsoConfig, now = Date.now()): Promise<Discovery> {
  if (discovered && discovered.issuer === cfg.issuer && now - discovered.at < DISCOVERY_TTL_MS) return discovered.doc;
  const { status, body } = await getJson(`${cfg.issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
  const d = body as Record<string, unknown> | null;
  if (status !== 200 || !d) throw new SsoError(`discovery: HTTP ${status}`);
  if (d.issuer !== cfg.issuer) throw new SsoError('discovery: the issuer it names is not the one set up');
  const doc: Discovery = {
    authorization_endpoint: endpoint(cfg.issuer, d.authorization_endpoint, 'authorization_endpoint'),
    token_endpoint: endpoint(cfg.issuer, d.token_endpoint, 'token_endpoint'),
    jwks_uri: endpoint(cfg.issuer, d.jwks_uri, 'jwks_uri'),
  };
  if (d.end_session_endpoint) doc.end_session_endpoint = endpoint(cfg.issuer, d.end_session_endpoint, 'end_session_endpoint');
  discovered = { issuer: cfg.issuer, at: now, doc };
  return doc;
}

/** The address that sends the person to Keycloak (and on to Microsoft). */
export function authorizeUrl(req: Request, cfg: SsoConfig, d: Discovery, flow: Flow): string {
  const url = new URL(d.authorization_endpoint);
  const p = url.searchParams;
  p.set('client_id', cfg.clientId);
  p.set('response_type', 'code');
  p.set('scope', 'openid email profile');
  p.set('redirect_uri', redirectUri(req, cfg));
  p.set('state', flow.state);
  p.set('nonce', flow.nonce);
  p.set('code_challenge', b64url(createHash('sha256').update(flow.verifier).digest()));
  p.set('code_challenge_method', 'S256');
  if (cfg.idpHint) p.set('kc_idp_hint', cfg.idpHint);
  return url.href;
}

// ---------- signing keys ----------

let jwks: { uri: string; at: number; keys: Jwk[] } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_RETRY_MS = 60 * 1000;

async function fetchKeys(uri: string, now: number) {
  const { status, body } = await getJson(uri, { headers: { accept: 'application/json' } });
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (status !== 200 || !Array.isArray(keys)) throw new SsoError(`jwks: HTTP ${status}`);
  jwks = { uri, at: now, keys: keys.filter((k): k is Jwk => !!k && typeof k === 'object') };
}

/** Keycloak's public key for this kid and alg; the list is fetched again when a new kid shows up (a key rotation). */
export async function keycloakKey(d: Discovery, kid: string | undefined, alg: string, now = Date.now()): Promise<KeyObject | null> {
  if (!jwks || jwks.uri !== d.jwks_uri || now - jwks.at > JWKS_TTL_MS) await fetchKeys(d.jwks_uri, now);
  let key = pickKey(jwks!.keys, kid, alg);
  if (!key && now - jwks!.at > JWKS_RETRY_MS) {
    await fetchKeys(d.jwks_uri, now);
    key = pickKey(jwks!.keys, kid, alg);
  }
  return key;
}

const ALGS: Record<string, { hash: string; kty: 'RSA' | 'EC'; pss?: boolean; curve?: string }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  PS256: { hash: 'sha256', kty: 'RSA', pss: true },
  PS384: { hash: 'sha384', kty: 'RSA', pss: true },
  PS512: { hash: 'sha512', kty: 'RSA', pss: true },
  ES256: { hash: 'sha256', kty: 'EC', curve: 'P-256' },
  ES384: { hash: 'sha384', kty: 'EC', curve: 'P-384' },
};

export function pickKey(keys: Jwk[], kid: string | undefined, alg: string): KeyObject | null {
  const want = ALGS[alg];
  if (!want) return null;
  const k = keys.find(
    (k) =>
      k.kty === want.kty &&
      (k.use === undefined || k.use === 'sig') &&
      (k.alg === undefined || k.alg === alg) &&
      (want.curve === undefined || k.crv === want.curve) &&
      (kid === undefined || k.kid === kid),
  );
  if (!k) return null;
  try {
    // public part only: a JWK with "d" would be a private key, which no list of public keys should carry
    const { d: _private, ...pub } = k;
    return createPublicKey({ key: pub, format: 'jwk' });
  } catch {
    return null;
  }
}

// ---------- the ID token ----------

export interface IdClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
}

const SKEW_S = 60;

/**
 * Checks the token Keycloak gave us: signed by Keycloak with an asymmetric key (never "none" or a
 * shared-secret alg), for this client, from this realm, not expired, and for this login (nonce).
 */
export async function verifyIdToken(
  token: string,
  opts: { issuer: string; clientId: string; nonce: string; now?: number; keyFor: (kid: string | undefined, alg: string) => Promise<KeyObject | null> },
): Promise<IdClaims> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]*$/.test(p))) throw new SsoError('id_token: not a JWT');
  let header: { alg?: unknown; kid?: unknown; crit?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  } catch {
    throw new SsoError('id_token: not JSON');
  }
  const alg = typeof header.alg === 'string' ? header.alg : '';
  const spec = ALGS[alg];
  if (!spec) throw new SsoError(`id_token: alg ${alg.slice(0, 10) || 'missing'} not accepted`);
  if (header.crit !== undefined) throw new SsoError('id_token: crit headers are not understood');
  const key = await opts.keyFor(typeof header.kid === 'string' ? header.kid : undefined, alg);
  if (!key) throw new SsoError('id_token: no key for it');
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2]!, 'base64url');
  const ok = spec.kty === 'EC'
    ? verifySignature(spec.hash, signed, { key, dsaEncoding: 'ieee-p1363' }, sig)
    : spec.pss
      ? verifySignature(spec.hash, signed, { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: -1 /* RSA_PSS_SALTLEN_DIGEST */ }, sig)
      : verifySignature(spec.hash, signed, key, sig);
  if (!ok) throw new SsoError('id_token: bad signature');

  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.iss !== opts.issuer) throw new SsoError('id_token: wrong issuer');
  const aud = claims.aud;
  const auds = Array.isArray(aud) ? aud : [aud];
  if (!auds.includes(opts.clientId)) throw new SsoError('id_token: not for this client');
  if (auds.length > 1 && claims.azp !== opts.clientId) throw new SsoError('id_token: azp is not this client');
  if (claims.azp !== undefined && claims.azp !== opts.clientId) throw new SsoError('id_token: azp is not this client');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= now) throw new SsoError('id_token: expired');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > now) throw new SsoError('id_token: issued in the future');
  if (typeof claims.nonce !== 'string' || !sameText(claims.nonce, opts.nonce)) throw new SsoError('id_token: nonce is not this login');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new SsoError('id_token: no sub');
  return claims as unknown as IdClaims;
}

/** Trades the one-time code for tokens, with our client secret and the PKCE verifier. */
export async function exchangeCode(cfg: SsoConfig, d: Discovery, code: string, redirect: string, verifier: string): Promise<string> {
  // client_secret_basic: id and secret form-encoded, then base64 (RFC 6749 2.3.1)
  const basic = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64');
  const { status, body } = await getJson(d.token_endpoint, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }).toString(),
  });
  const b = body as { id_token?: unknown; error?: unknown } | null;
  if (status !== 200 || typeof b?.id_token !== 'string') {
    // the error code only (invalid_grant, unauthorized_client…): the body may echo things we do not log
    const why = typeof b?.error === 'string' && /^[\w.-]{1,64}$/.test(b.error) ? b.error : 'no id_token';
    throw new SsoError(`token: HTTP ${status} ${why}`);
  }
  return b.id_token;
}

// ---------- who gets in ----------

/** The work email in the token: email, else preferred_username (some people from Microsoft have only that), lowercase. */
export function emailFrom(claims: Pick<IdClaims, 'email' | 'preferred_username'>): string | null {
  const pick = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const e = pick(claims.email) || pick(claims.preferred_username);
  return e.length <= 254 && /^[^\s@<>"]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(e) ? e : null;
}

/**
 * The account with this work email (in any case), the one an admin gave the person with
 * `npm run users -- invite` or `email`. Nobody else gets in: 403 no_account. Disabled accounts get
 * 403 account_disabled; and since every request re-reads the account, disabling one ends its
 * sessions at once, which Keycloak alone could not.
 */
export async function findSsoUser(sql: Sql, email: string): Promise<SessionUser> {
  const rows = await sql.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM ib_users WHERE lower(email) = $1 LIMIT 2`,
    [email.toLowerCase()],
  );
  if (rows.length > 1) {
    // setLocalEmail never lets two accounts share one; refuse rather than guess between them
    console.error('[sso] two accounts have the same email; login refused until an admin fixes it');
    throw new HttpError(403, 'no_account');
  }
  const u = rows[0];
  if (!u) throw new HttpError(403, 'no_account');
  if (u.disabled) throw new HttpError(403, 'account_disabled');
  return toSessionUser(u);
}

// ---------- answers for the browser ----------

/** `next` from a login link, if it is a short path on this site ('/x', never '//evil' or 'https:…'). */
export function safeNext(next: unknown, fallback = '/host'): string {
  return typeof next === 'string' && next.length <= 512 && /^\/(?![/\\])/.test(next) && !/[\u0000-\u001f\\]/.test(next) ? next : fallback;
}

/** A redirect inside the app. Relative, so it is right behind nginx too (the request reaches Next as 127.0.0.1). */
export function redirectTo(pathInApp: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: `${basePath()}${pathInApp}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 303, headers });
}

/** Back to the login page with a reason it can show (sso_failed, no_account…). */
export const backToLogin = (error: string, next: string, cookies: string[] = []) =>
  redirectTo(`/login?${new URLSearchParams({ error, next })}`, cookies);

/** For tests: forget what Keycloak published. */
export function resetSsoCache() {
  discovered = null;
  jwks = null;
}
