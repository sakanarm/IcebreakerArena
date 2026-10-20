// Local accounts (AUTH_MODE=local), for an admin at the server's terminal. Run from the repo root:
//
//   npm run users -- check                                        login mode, database and schema; changes nothing
//   npm run users -- list
//   npm run users -- add <username> "<display name>" [--admin]   prints a new password, once
//   npm run users -- reset <username>                             new password, logs the account out everywhere
//   npm run users -- disable <username> | enable <username>
//   npm run users -- demo <username> [--share]                    adds the demo games; --share also lists one in the catalog
//
// add and reset take --out=<file> to save the password in a new file only this account can read, instead of
// printing it. On the server, prefix NODE_ENV=production so it uses the database in var/secrets/database-url.
// On a laptop it uses the dev database in var/pglite: stop `npm run dev` first, since only one
// process may have that folder open (check does not open it).
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';
import { authModeProblem, authModeSource, dataDir, databaseUrl, dbSchema, readSecret } from '../src/server/config';
import { SCHEMA_VERSION, checkSchemaName, connectPostgres, getDb } from '../src/server/db';
import { DEMO_GAMES, SHARED_DEMO, addDemoGames } from '../src/server/demo-games';
import { HttpError } from '../src/server/http';
import { LOCAL_ISSUER, createLocalUser, generatePassword, normalizeUsername, setLocalPassword } from '../src/server/local-users';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));
// relative to the folder npm was run from, not apps/web where this runs
const outArg = [...flags].find((f) => f.startsWith('--out='))?.slice('--out='.length);
const out = outArg ? path.resolve(process.env.INIT_CWD ?? process.cwd(), outArg) : null;

function usage(): never {
  console.error(
    'usage: users check | list | add <username> "<display name>" [--admin] [--out=<file>] | reset <username> [--out=<file>] | disable <username> | enable <username> | demo <username> [--share]',
  );
  process.exit(2);
}

// a mistyped flag (--admn) must not quietly make a different account
const FLAGS: Record<string, string[]> = { add: ['--admin', '--out='], reset: ['--out='], demo: ['--share'] };
for (const f of flags) {
  if (!(FLAGS[cmd ?? ''] ?? []).some((ok) => (ok.endsWith('=') ? f.startsWith(ok) && f.length > ok.length : f === ok))) usage();
}

const showPassword = (username: string, password: string) =>
  console.log(`\n  username: ${username}\n  password: ${password}\n\n  Shown this once only. Hand it over in person or by a private message, not in a group chat.\n`);

/** Makes a password for `apply` (which answers the username), then shows it once or saves it to --out. */
async function newPassword(apply: (password: string) => Promise<string>) {
  const password = generatePassword();
  // the file comes first: if it can't be made, no account gets a password nobody has seen
  let fd: number | null = null;
  if (out) {
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
    try {
      fd = openSync(out, 'wx', 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${out} already exists: pick another file, or delete that one first`);
      throw e;
    }
  }
  let username: string;
  try {
    username = await apply(password);
  } catch (e) {
    if (fd !== null) {
      closeSync(fd);
      rmSync(out!, { force: true });
    }
    throw e;
  }
  if (fd === null) return showPassword(username, password);
  writeSync(fd, `username: ${username}\npassword: ${password}\n`);
  closeSync(fd);
  console.log(`\n  The password is in ${out}, which only this server account can read.\n  Hand it over privately, then delete the file.\n`);
}

/** Login mode, database and schema, reading only: deploy.sh runs it before it builds. False when something is wrong. */
async function check(): Promise<boolean> {
  const problems: string[] = [];
  const say = (line: string) => console.log(`  ${line}`);
  const done = () => {
    for (const p of problems) console.log(`  problem: ${p}`);
    if (!problems.length) say('ok');
    return problems.length === 0;
  };

  const source = authModeSource();
  const modeProblem = authModeProblem(source);
  say(`login: ${source.raw.toLowerCase()} (${source.from === 'default' ? 'the default' : `from ${source.from}`})`);
  if (modeProblem) problems.push(modeProblem);
  const accountsOn = !modeProblem && source.raw.toLowerCase() !== 'off';

  const secretFile = path.join(dataDir(), 'secrets', 'database-url');
  const url = databaseUrl();
  if (!url) {
    if (!accountsOn) say('database: none, and none is needed while accounts are off');
    else if (process.env.NODE_ENV !== 'production') say(`database: the dev one in ${path.join(dataDir(), 'pglite')}`);
    else problems.push(`accounts are on but there is no database: put its connection string in ${secretFile}`);
    return done();
  }
  const fromFile = readSecret('database-url') !== null;
  say(`database: ${fromFile ? secretFile : 'DATABASE_URL'}`);
  if (fromFile && process.platform !== 'win32') {
    for (const [p, want] of [[secretFile, '600'], [path.dirname(secretFile), '700']] as const) {
      const mode = statSync(p).mode & 0o777;
      if (mode & 0o077) problems.push(`${p} is mode ${mode.toString(8)}, open to other accounts: chmod ${want} it`);
    }
  }
  let schema: string;
  try {
    schema = checkSchemaName(dbSchema());
  } catch (e) {
    problems.push(message(e));
    return done();
  }

  const db = await connectPostgres(url, schema);
  try {
    const [me] = await db.query<{ db: string; user: string; version: string; search_path: string; may_make_schema: boolean }>(
      `SELECT current_database() AS db, current_user AS user, current_setting('server_version') AS version,
              current_setting('search_path') AS search_path, has_database_privilege(current_database(), 'CREATE') AS may_make_schema`,
    );
    say(`connected: database ${me!.db} as ${me!.user}, Postgres ${me!.version}, search_path ${me!.search_path}`);
    if (me!.search_path !== schema) problems.push(`search_path is "${me!.search_path}", not "${schema}"`);

    const [ns] = await db.query<{ owner: string; may_create: boolean }>(
      "SELECT pg_get_userbyid(nspowner) AS owner, has_schema_privilege(oid, 'CREATE') AS may_create FROM pg_namespace WHERE nspname = $1",
      [schema],
    );
    if (!ns) {
      say(`schema ${schema}: not there yet, made the first time the database is used (a login, or users add)`);
      if (!me!.may_make_schema) problems.push(`schema ${schema} is missing and ${me!.user} may not create schemas in ${me!.db}: ask for one owned by ${me!.user}`);
    } else {
      say(`schema ${schema}: owner ${ns.owner}`);
      if (!ns.may_create) problems.push(`${me!.user} may not create tables in schema ${schema}`);
    }

    const tables = ns ? await db.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 AND tablename LIKE 'ib\\_%'", [schema]) : [];
    if (!tables.some((t) => t.name === 'ib_schema')) say(`tables: none yet, made (v${SCHEMA_VERSION}) the first time the database is used (a login, or users add)`);
    else {
      const version = (await db.query<{ version: number }>(`SELECT version FROM ${schema}.ib_schema`))[0]?.version ?? 0;
      say(`tables: ${tables.length}, v${version}${version < SCHEMA_VERSION ? `, upgraded to v${SCHEMA_VERSION} the first time this app uses the database` : ''}`);
      if (version > SCHEMA_VERSION) problems.push(`the tables are v${version}, newer than this app (v${SCHEMA_VERSION}): deploy the newer app`);
      if (version >= 1) {
        const [acc] = await db.query<{ n: number; admins: number }>(
          `SELECT count(*)::int AS n, (count(*) FILTER (WHERE is_curator))::int AS admins FROM ${schema}.ib_users WHERE issuer = $1 AND NOT disabled`,
          [LOCAL_ISSUER],
        );
        say(`local accounts: ${acc!.n} (${acc!.admins} admin)`);
      }
    }
    // tables of ours anywhere else (public) would mean something once ran without the schema
    const elsewhere = await db.query<{ name: string }>(
      "SELECT DISTINCT schemaname AS name FROM pg_tables WHERE tablename IN ('ib_schema', 'ib_users') AND schemaname <> $1 ORDER BY 1",
      [schema],
    );
    if (elsewhere.length) say(`note: there are ib_ tables in ${elsewhere.map((s) => s.name).join(', ')} too; the app does not use them`);
  } catch (e) {
    problems.push(`database: ${message(e)}`);
  } finally {
    await db.close();
  }
  return done();
}

/** An error's text, with any database URL in it blanked out. */
function message(e: unknown): string {
  const text = e instanceof HttpError ? e.code : e instanceof Error ? e.message : String(e);
  return text.replace(/\bpostgres(?:ql)?:\/\/\S*/gi, '<database url>');
}

async function main() {
  if (cmd === 'check') {
    if (!(await check())) process.exitCode = 1;
    return;
  }
  if (!['list', 'add', 'reset', 'disable', 'enable', 'demo'].includes(cmd ?? '')) usage();
  const db = await getDb();
  try {
    switch (cmd) {
      case 'list': {
        const rows = await db.query<{ subject: string; display_name: string; is_curator: boolean; disabled: boolean; last_login: Date | null; has_password: boolean }>(
          `SELECT u.subject, u.display_name, u.is_curator, u.disabled, p.user_id IS NOT NULL AS has_password,
                  (SELECT max(a.at) FROM ib_audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS last_login
             FROM ib_users u LEFT JOIN ib_passwords p ON p.user_id = u.id
            WHERE u.issuer = $1 ORDER BY u.subject`,
          [LOCAL_ISSUER],
        );
        if (!rows.length) console.log('no local accounts yet');
        for (const r of rows) {
          const tags = [r.is_curator && 'admin', r.disabled && 'disabled', !r.has_password && 'no password'].filter(Boolean).join(', ');
          console.log(`${r.subject.padEnd(20)} ${r.display_name}${tags ? `  [${tags}]` : ''}  ${r.last_login ? `last login ${new Date(r.last_login).toISOString().slice(0, 16)}` : 'never logged in'}`);
        }
        return;
      }
      case 'add': {
        const [username, name] = args;
        if (!username || !name) usage();
        await newPassword(async (password) => {
          await db.tx((sql) => createLocalUser(sql, { username, name, password, curator: flags.has('--admin') }));
          console.log(`made ${flags.has('--admin') ? 'admin ' : ''}account "${normalizeUsername(username)}" (${name})`);
          return normalizeUsername(username)!;
        });
        return;
      }
      case 'reset': {
        const [username] = args;
        if (!username) usage();
        await newPassword(async (password) => {
          if (!(await db.tx((sql) => setLocalPassword(sql, username, password)))) throw new Error(`no local account "${username}"`);
          console.log(`new password for "${normalizeUsername(username)}"; it is logged out everywhere`);
          return normalizeUsername(username)!;
        });
        return;
      }
      case 'disable':
      case 'enable': {
        const [username] = args;
        if (!username) usage();
        const off = cmd === 'disable';
        const changed = await db.tx(async (sql) => {
          const rows = await sql.query<{ id: string }>('UPDATE ib_users SET disabled = $3 WHERE issuer = $1 AND subject = $2 RETURNING id', [LOCAL_ISSUER, normalizeUsername(username), off]);
          if (rows[0] && off) await sql.query('DELETE FROM ib_sessions WHERE user_id = $1', [rows[0].id]);
          return rows.length > 0;
        });
        if (!changed) throw new Error(`no local account "${username}"`);
        console.log(`${off ? 'disabled' : 'enabled'} "${normalizeUsername(username)}"`);
        return;
      }
      case 'demo': {
        const [username] = args;
        if (!username) usage();
        const [u] = await db.query<{ id: string; display_name: string; email: string | null; is_curator: boolean; disabled: boolean }>(
          'SELECT id, display_name, email, is_curator, disabled FROM ib_users WHERE issuer = $1 AND subject = $2',
          [LOCAL_ISSUER, normalizeUsername(username)],
        );
        if (!u) throw new Error(`no local account "${username}"`);
        if (u.disabled) throw new Error(`"${normalizeUsername(username)}" is disabled`);
        const res = await addDemoGames(db, { id: u.id, name: u.display_name, email: u.email, isCurator: u.is_curator }, { share: flags.has('--share') });
        for (const t of res.made) console.log(`made  ${t}`);
        for (const t of res.kept) console.log(`kept  ${t} (the account has a game by this title)`);
        const shared = DEMO_GAMES.find((g) => g.id === SHARED_DEMO)!.title;
        if (res.shared) console.log(res.shared === 'listed' ? `shared ${shared} in the catalog` : `${shared} was already in the catalog`);
        return;
      }
    }
  } finally {
    await db.close();
  }
}

main().catch((e: unknown) => {
  const text: Record<string, string> = {
    bad_username: 'a username is 3–32 of a-z, 0-9, dot, dash or underscore, starting with a letter or digit',
    bad_name: 'the display name must be 2–40 characters',
    username_taken: 'that username is taken',
  };
  console.error(e instanceof HttpError ? (text[e.code] ?? e.code) : message(e));
  process.exit(1);
});
