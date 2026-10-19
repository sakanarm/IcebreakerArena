import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * - off: no accounts, games stay in each browser (the app as it has always been)
 * - mock: log in with a name only, for development and tests; refused when NODE_ENV=production
 * - oidc: company login (Entra ID), not wired up yet
 */
export type AuthMode = 'off' | 'mock' | 'oidc';

let warnedMock = false;

export function authMode(): AuthMode {
  const raw = (process.env.AUTH_MODE ?? '').trim().toLowerCase();
  if (raw === 'oidc') return 'oidc';
  if (raw === 'mock') {
    if (process.env.NODE_ENV !== 'production') return 'mock';
    if (!warnedMock) console.error('[auth] AUTH_MODE=mock is refused in production, running with AUTH_MODE=off');
    warnedMock = true;
  }
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

/** The subpath the app is served under, same rules as next.config.ts; cookies are scoped to it. */
export function basePath(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim().replace(/\/+$/, '');
  return raw ? raw.replace(/^(?=[^/])/, '/') : '';
}

/** HTTPS-only cookies with the __Secure- name in production; plain ones for http dev on a laptop or LAN IP. */
export const secureCookies = () => process.env.NODE_ENV === 'production';
