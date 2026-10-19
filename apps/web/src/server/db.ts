import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { databaseUrl, dataDir } from './config';

export type Row = Record<string, unknown>;

export interface Sql {
  /** one statement with $1, $2 … parameters */
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** several statements, no parameters (migrations) */
  exec(text: string): Promise<void>;
}

export interface Db extends Sql {
  tx<R>(fn: (sql: Sql) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

/** Postgres on the network: production. */
export async function connectPostgres(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'icebreaker',
  });
  // a dropped idle connection must not crash the web app; the next query reconnects
  pool.on('error', (e) => console.error('[db] idle connection error:', e.message));
  const run = async <T>(c: Pool | PoolClient, text: string, params?: unknown[]) => (await c.query(text, params)).rows as T[];
  return {
    query: (text, params) => run(pool, text, params),
    exec: async (text) => void (await pool.query(text)),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => run(client, text, params), exec: async (text) => void (await client.query(text)) });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Postgres compiled to WASM, in this process: local development (a folder) and tests (in memory). */
export async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  return {
    query: async (text, params) => (await db.query(text, params)).rows as never,
    exec: async (text) => void (await db.exec(text)),
    tx: (fn) =>
      db.transaction((t) => fn({ query: async (text, params) => (await t.query(text, params)).rows as never, exec: async (text) => void (await t.exec(text)) })),
    close: () => db.close(),
  };
}

/** Thrown when accounts are on but no database is set up; routes answer 503. */
export class DbUnavailable extends Error {}

type Holder = { __ibDb?: Promise<Db>; __ibDbSchema?: number };

/** The app's database, opened and migrated on first use. Kept on globalThis so dev hot reloads reuse it. */
export function getDb(): Promise<Db> {
  const g = globalThis as Holder;
  const forget = (e: unknown) => {
    g.__ibDb = undefined;
    throw e;
  };
  // a dev hot reload can bring migrations the open database has not had yet
  if (g.__ibDb && g.__ibDbSchema !== MIGRATIONS.length) {
    g.__ibDb = g.__ibDb
      .then(async (db) => {
        try {
          await migrate(db);
          return db;
        } catch (e) {
          await db.close().catch(() => {});
          throw e;
        }
      })
      .catch(forget);
  }
  g.__ibDbSchema = MIGRATIONS.length;
  g.__ibDb ??= open().catch(forget);
  return g.__ibDb;
}

async function open(): Promise<Db> {
  const url = databaseUrl();
  let db: Db;
  if (url) db = await connectPostgres(url);
  else if (process.env.NODE_ENV !== 'production') db = await openPglite(path.join(dataDir(), 'pglite'));
  else throw new DbUnavailable('no database: put the connection string in var/secrets/database-url');
  try {
    await migrate(db);
  } catch (e) {
    // the next request tries again with a fresh connection; this one must not linger
    await db.close().catch(() => {});
    throw e;
  }
  return db;
}

/**
 * Serialises the few writes that change what exists or what is shared: creating, copying, deleting,
 * sharing, withdrawing and reporting. They are rare and quick, and one lock rules out races between a
 * takedown and a copy or re-share of the same content, as well as two requests both passing a quota.
 * Call it first thing inside db.tx.
 */
export const lockWrites = (sql: Sql) => sql.query('SELECT pg_advisory_xact_lock(4231002)');

/**
 * Schema changes, applied in order and recorded in ib_schema. Never edit a shipped step; add a new one.
 * Every table starts with ib_ so the app can share a database or schema with others.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE ib_users (
    id text PRIMARY KEY,
    issuer text NOT NULL,
    subject text NOT NULL,
    display_name text NOT NULL,
    email text,
    is_curator boolean NOT NULL DEFAULT false,
    disabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject)
  );

  CREATE TABLE ib_sessions (
    id_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES ib_users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX ib_sessions_user ON ib_sessions (user_id);
  CREATE INDEX ib_sessions_expires ON ib_sessions (expires_at);

  CREATE TABLE ib_games (
    id text PRIMARY KEY,
    owner_id text NOT NULL REFERENCES ib_users (id) ON DELETE CASCADE,
    title text NOT NULL,
    data jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1,
    tainted boolean NOT NULL DEFAULT false,
    origin text NOT NULL,
    origin_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX ib_games_owner ON ib_games (owner_id, updated_at DESC);
  CREATE UNIQUE INDEX ib_games_from_local ON ib_games (owner_id, origin_ref) WHERE origin = 'local';

  CREATE TABLE ib_catalog_entries (
    id text PRIMARY KEY,
    game_id text REFERENCES ib_games (id) ON DELETE SET NULL,
    author_id text NOT NULL REFERENCES ib_users (id),
    author_name text NOT NULL,
    title text NOT NULL,
    data jsonb NOT NULL,
    status text NOT NULL DEFAULT 'listed' CHECK (status IN ('listed', 'hidden', 'withdrawn')),
    hidden_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    status_at timestamptz
  );
  CREATE INDEX ib_catalog_status ON ib_catalog_entries (status, created_at DESC);
  CREATE UNIQUE INDEX ib_catalog_one_per_game ON ib_catalog_entries (game_id) WHERE status <> 'withdrawn';

  CREATE TABLE ib_catalog_reports (
    entry_id text NOT NULL REFERENCES ib_catalog_entries (id) ON DELETE CASCADE,
    reporter_id text NOT NULL REFERENCES ib_users (id) ON DELETE CASCADE,
    reason text NOT NULL CHECK (reason IN ('confidential', 'inappropriate', 'other')),
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, reporter_id)
  );

  CREATE TABLE ib_audit_log (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    user_id text,
    action text NOT NULL,
    target text,
    detail jsonb
  );
  CREATE INDEX ib_audit_at ON ib_audit_log (at);
  `,
  // Takedowns that reach copies. ancestors: the game and entry ids a game's content came from, oldest
  // first, kept after those are deleted. source_game: the game an entry was shared from (game_id is
  // nulled when that game is deleted). hold, on a reported entry: the ids whose content it took down,
  // meaning the entry, its game and the copies that game was made from since the last catalog copy;
  // a game with any of these ids (or the entry's) in its lineage can't be shared until a curator
  // clears the hold. held_by: the reported entry whose takedown hid this one.
  `
  ALTER TABLE ib_games ADD COLUMN ancestors jsonb NOT NULL DEFAULT '[]';
  ALTER TABLE ib_catalog_entries ADD COLUMN source_game text;
  ALTER TABLE ib_catalog_entries ADD COLUMN ancestors jsonb NOT NULL DEFAULT '[]';
  ALTER TABLE ib_catalog_entries ADD COLUMN hold jsonb;
  ALTER TABLE ib_catalog_entries ADD COLUMN held_by text;
  UPDATE ib_catalog_entries SET source_game = game_id;

  WITH RECURSIVE tree (id, anc) AS (
    SELECT g.id, CASE WHEN g.origin IN ('copy', 'catalog') AND g.origin_ref IS NOT NULL THEN jsonb_build_array(g.origin_ref) ELSE '[]'::jsonb END
      FROM ib_games g
     WHERE NOT (g.origin = 'copy' AND EXISTS (SELECT 1 FROM ib_games p WHERE p.id = g.origin_ref))
       AND NOT (g.origin = 'catalog' AND EXISTS (SELECT 1 FROM ib_catalog_entries e JOIN ib_games p ON p.id = e.game_id WHERE e.id = g.origin_ref))
    UNION
    SELECT g.id, CASE WHEN g.origin = 'copy' THEN t.anc || to_jsonb(t.id) ELSE t.anc || jsonb_build_array(t.id, e.id) END
      FROM tree t
      LEFT JOIN ib_catalog_entries e ON e.game_id = t.id
      JOIN ib_games g ON (g.origin = 'copy' AND g.origin_ref = t.id) OR (g.origin = 'catalog' AND g.origin_ref = e.id)
  )
  UPDATE ib_games g SET ancestors = t.anc FROM tree t WHERE g.id = t.id;
  UPDATE ib_catalog_entries e SET ancestors = g.ancestors FROM ib_games g WHERE g.id = e.game_id;

  UPDATE ib_catalog_entries e
     SET held_by = e.id,
         hold = jsonb_build_array(e.id)
           || CASE WHEN e.source_game IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(e.source_game) END
           || COALESCE((SELECT jsonb_agg(a.x ORDER BY a.n) FROM jsonb_array_elements_text(e.ancestors) WITH ORDINALITY a (x, n)
                         WHERE a.n > COALESCE((SELECT max(b.n) FROM jsonb_array_elements_text(e.ancestors) WITH ORDINALITY b (x, n)
                                                 JOIN ib_catalog_entries k ON k.id = b.x), 0)), '[]'::jsonb)
   WHERE e.hidden_reason IS NOT NULL;
  -- what a takedown now does to listed copies, done once for the takedowns made before (see reportEntry)
  UPDATE ib_catalog_entries c
     SET status = 'hidden', status_at = now(), held_by = h.id, hidden_reason = 'copy_of_hidden'
    FROM ib_catalog_entries h
   WHERE h.hold IS NOT NULL AND c.id <> h.id AND c.status = 'listed'
     AND (h.hold ? c.source_game OR c.ancestors ?| ARRAY(SELECT jsonb_array_elements_text(h.hold)));

  CREATE INDEX ib_games_ancestors ON ib_games USING gin (ancestors);
  CREATE INDEX ib_catalog_ancestors ON ib_catalog_entries USING gin (ancestors);
  CREATE INDEX ib_catalog_source ON ib_catalog_entries (source_game);
  CREATE INDEX ib_catalog_holds ON ib_catalog_entries (id) WHERE hold IS NOT NULL;
  `,
];

/** `upTo` is for tests that start from an older schema. */
export async function migrate(db: Db, upTo = MIGRATIONS.length) {
  await db.tx(async (sql) => {
    // two app processes starting at once must not both migrate
    await sql.query('SELECT pg_advisory_xact_lock(4231001)');
    await sql.exec('CREATE TABLE IF NOT EXISTS ib_schema (version integer NOT NULL)');
    const rows = await sql.query<{ version: number }>('SELECT version FROM ib_schema');
    if (rows.length === 0) await sql.query('INSERT INTO ib_schema (version) VALUES (0)');
    const from = rows[0]?.version ?? 0;
    if (from > MIGRATIONS.length) throw new Error(`database schema v${from} is newer than this app (v${MIGRATIONS.length})`);
    for (const step of MIGRATIONS.slice(from, upTo)) await sql.exec(step);
    if (from < upTo) await sql.query('UPDATE ib_schema SET version = $1', [upTo]);
  });
}
