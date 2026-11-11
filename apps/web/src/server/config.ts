import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * - off: no accounts, games stay in each browser (the app as it has always been)
 * - mock: log in with a name only, for development and tests; refused when NODE_ENV=production
 * - local: username and password kept in our database, accounts made by an admin (`npm run users`);
 *   when company login is set up (ssoConfig) its button shows beside the password form
 * - oidc: company login only (Keycloak, which hands over to Microsoft Entra ID); the password form is gone
 */
export type AuthMode = 'off' | 'mock' | 'local' | 'oidc';
const MODES: readonly string[] = ['off', 'mock', 'local', 'oidc'];

export type AuthModeSource = { raw: string; from: 'AUTH_MODE' | 'var/auth-mode' | 'default' };

// var/auth-mode is read once per process (per data folder, for tests): restart the web app after changing it
let modeFile: { dir: string; text: string } | null = null;

/**
 * Where the mode comes from: AUTH_MODE in the environment, else the one word in var/auth-mode, else off.
 * The file lets the server switch login on without touching the pm2 env.
 */
export function authModeSource(): AuthModeSource {
  const env = process.env.AUTH_MODE?.trim();
  if (env) return { raw: env, from: 'AUTH_MODE' };
  const dir = dataDir();
  if (modeFile?.dir !== dir) {
    let text = '';
    try {
      text = readFileSync(path.join(dir, 'auth-mode'), 'utf8').trim();
    } catch {
      // no file: off
    }
    modeFile = { dir, text };
  }
  return modeFile.text ? { raw: modeFile.text, from: 'var/auth-mode' } : { raw: 'off', from: 'default' };
}

/** Why a mode can't be used here, or null when it can. */
export function authModeProblem({ raw, from }: AuthModeSource): string | null {
  const mode = raw.toLowerCase();
  if (!MODES.includes(mode)) return `unknown ${from} "${raw}" (use off, local or oidc)`;
  if (mode === 'mock' && process.env.NODE_ENV === 'production') return `${from}=mock is refused in production`;
  if (mode === 'oidc') {
    const sso = ssoSource();
    if (!sso.config) return `${from}=oidc needs company login: ${sso.problem ?? `put its settings in ${SSO_FILE}`}`;
  }
  return null;
}

const warned = new Set<string>();

export function authMode(): AuthMode {
  const source = authModeSource();
  const problem = authModeProblem(source);
  if (!problem) return source.raw.toLowerCase() as AuthMode;
  if (!warned.has(problem)) console.error(`[auth] ${problem}, running with accounts off`);
  warned.add(problem);
  return 'off';
}

/** Runtime data and secrets: `<repo>/var` (git-ignored), or IB_DATA_DIR. Next and the tests run from apps/web. */
export function dataDir(): string {
  const dir = process.env.IB_DATA_DIR?.trim();
  return dir ? path.resolve(dir) : path.resolve(process.cwd(), '../../var');
}

/** A secret kept as a file under var/secrets (mode 600), never in the pm2 env or the repo. */
export function readSecret(name: string): string | null {
  try {
    const value = readFileSync(path.join(dataDir(), 'secrets', name), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

// ---------- company login (Keycloak) ----------

export const SSO_FILE = 'var/secrets/keycloak.json';

export interface SsoConfig {
  /** the realm, e.g. https://dmhub.mfec.dev:8443/realms/mfec, never with a slash at the end */
  issuer: string;
  /** this app's own Keycloak client, never another app's */
  clientId: string;
  clientSecret: string;
  /**
   * The site people open, scheme and host only (https://dmhub.mfec.dev): the base path is added to it.
   * Required in production, where the request reaches Next from nginx as 127.0.0.1. Left out on a laptop,
   * where the address the browser used is right (http://localhost:3000).
   */
  appUrl: string | null;
  /** sent as kc_idp_hint so Keycloak goes straight to Microsoft; '' shows Keycloak's own page */
  idpHint: string;
  from: typeof SSO_FILE | 'env';
}

export type SsoSource = { config: SsoConfig | null; problem: string | null; from: SsoConfig['from'] | null };

const isLocalHost = (u: URL) => u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';

/** An https URL (http only to this machine, and not in production), or why not. */
function checkUrl(raw: unknown, what: string): { url: URL } | { problem: string } {
  let url: URL;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    return { problem: `${what} is not a URL` };
  }
  if (url.search || url.hash || url.username || url.password) return { problem: `${what} must not carry a query, a #part or a login` };
  if (url.protocol === 'https:') return { url };
  if (url.protocol === 'http:' && isLocalHost(url) && process.env.NODE_ENV !== 'production') return { url };
  return { problem: `${what} must start with https://` };
}

/**
 * Company login settings: var/secrets/keycloak.json ({ issuer, clientId, clientSecret, appUrl, idpHint? }),
 * else KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET and AUTH_URL for a laptop.
 * Read on every call: the file is small, and a fix needs no restart.
 */
export function ssoSource(): SsoSource {
  let raw: Record<string, unknown>;
  let from: SsoConfig['from'];
  const file = readSecret('keycloak.json');
  if (file) {
    from = SSO_FILE;
    try {
      const parsed: unknown = JSON.parse(file);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      raw = parsed as Record<string, unknown>;
    } catch {
      return { config: null, from, problem: `${SSO_FILE} is not a JSON object` };
    }
  } else if (process.env.KEYCLOAK_ISSUER?.trim()) {
    from = 'env';
    raw = {
      issuer: process.env.KEYCLOAK_ISSUER,
      clientId: process.env.KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      appUrl: process.env.AUTH_URL,
    };
  } else return { config: null, from: null, problem: null };

  const bad = (problem: string): SsoSource => ({ config: null, from, problem: `${from === 'env' ? 'KEYCLOAK_*' : SSO_FILE}: ${problem}` });
  // a slash at the end would make the discovery URL //.well-known and the issuer check fail
  const issuer = checkUrl(typeof raw.issuer === 'string' ? raw.issuer.trim().replace(/\/+$/, '') : '', 'issuer');
  if ('problem' in issuer) return bad(issuer.problem);
  const clientId = typeof raw.clientId === 'string' ? raw.clientId.trim() : '';
  if (!/^[\x21-\x7e]{1,255}$/.test(clientId)) return bad('clientId is missing');
  const clientSecret = typeof raw.clientSecret === 'string' ? raw.clientSecret.trim() : '';
  if (!/^[\x21-\x7e]{8,1024}$/.test(clientSecret)) return bad('clientSecret is missing');
  let appUrl: string | null = null;
  const appRaw = typeof raw.appUrl === 'string' ? raw.appUrl.trim().replace(/\/+$/, '') : '';
  if (appRaw) {
    const app = checkUrl(appRaw, 'appUrl');
    if ('problem' in app) return bad(app.problem);
    if (app.url.pathname !== '/') return bad('appUrl is the site only (https://host), the base path is added from NEXT_PUBLIC_BASE_PATH');
    appUrl = app.url.origin;
  } else if (process.env.NODE_ENV === 'production') return bad('appUrl is required in production (the site people open, e.g. https://dmhub.mfec.dev)');
  const idpHint = raw.idpHint === undefined ? 'entra' : typeof raw.idpHint === 'string' && /^[\w.-]{0,64}$/.test(raw.idpHint) ? raw.idpHint : null;
  if (idpHint === null) return bad('idpHint must be a short name, or "" for none');
  return { config: { issuer: issuer.url.href.replace(/\/+$/, ''), clientId, clientSecret, appUrl, idpHint, from }, from, problem: null };
}

const ssoWarned = new Set<string>();

/** Company login settings when they are complete, else null (a problem is logged once). */
export function ssoConfig(): SsoConfig | null {
  const { config, problem } = ssoSource();
  if (problem && !ssoWarned.has(problem)) {
    ssoWarned.add(problem);
    console.error(`[sso] ${problem}; company login is off`);
  }
  return config;
}

/** True when the login page offers company login: accounts are on and Keycloak is set up. */
export function ssoAvailable(): boolean {
  const mode = authMode();
  return (mode === 'local' || mode === 'oidc') && ssoConfig() !== null;
}

/** Postgres connection string: var/secrets/database-url first, then DATABASE_URL for local setups. */
export function databaseUrl(): string | null {
  return readSecret('database-url') ?? (process.env.DATABASE_URL?.trim() || null);
}

/** The Postgres schema our tables live in: IB_DB_SCHEMA, else icebreaker. The name the tables have lived under since day one: a brand is not worth a migration. Never public, as the database may be shared. */
export function dbSchema(): string {
  return process.env.IB_DB_SCHEMA?.trim() || 'icebreaker';
}

/** The subpath the app is served under, same rules as next.config.ts; cookies are scoped to it. */
export function basePath(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim().replace(/\/+$/, '');
  return raw ? raw.replace(/^(?=[^/])/, '/') : '';
}

/** HTTPS-only cookies with the __Secure- name in production; plain ones for http dev on a laptop or LAN IP. */
export const secureCookies = () => process.env.NODE_ENV === 'production';
