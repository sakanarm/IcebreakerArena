import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * - off: no accounts, games stay in each browser (the app as it has always been)
 * - mock: log in with a name only, for development and tests; refused when NODE_ENV=production
 * - local: username and password kept in our database, accounts made by an admin (`npm run users`)
 * - oidc: company login (Entra ID), not wired up yet
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

/** Postgres connection string: var/secrets/database-url first, then DATABASE_URL for local setups. */
export function databaseUrl(): string | null {
  return readSecret('database-url') ?? (process.env.DATABASE_URL?.trim() || null);
}

/** The Postgres schema our tables live in: IB_DB_SCHEMA, else icebreaker. Never public, as the database may be shared. */
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
