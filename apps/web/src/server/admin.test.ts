/**
 * The admin page (app/admin) from the server's side: roles and permissions, the rules that keep the
 * site runnable (no admin can lock themself or everyone out), and the AI settings file. Two things are
 * checked in every direction: nobody but an admin gets an answer from /api/admin, and the AI key and
 * header values written there never come back out, not in a view, a route answer or a test result.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { SAMPLE_GAMES } from '@pika-arena/shared';
import * as aiRoute from '@/app/api/admin/ai/route';
import * as aiTestRoute from '@/app/api/admin/ai/test/route';
import * as overviewRoute from '@/app/api/admin/overview/route';
import * as passwordRoute from '@/app/api/admin/users/[id]/password/route';
import * as userRoute from '@/app/api/admin/users/[id]/route';
import * as sessionsRoute from '@/app/api/admin/users/[id]/sessions/route';
import * as usersRoute from '@/app/api/admin/users/route';
import * as meRoute from '@/app/api/auth/me/route';
import * as catalogRoute from '@/app/api/catalog/route';
import { createUser, endSessions, listUsers, readNewUser, readPatch, recentChanges, resetPassword, updateUser } from './admin';
import { aiConfig } from './ai';
import { aiSettingsView, mergeAiSettings, resetAiTests, saveAiSettings, testAi } from './ai-settings';
import { upsertUser } from './auth';
import { SCHEMA_VERSION, getDb, migrate, openPglite, type Db } from './db';
import { createGame } from './games';
import { HttpError } from './http';
import { checkLocalLogin, createLocalUser, resetLoginThrottle } from './local-users';
import { readPerms, storedPerms } from './roles';
import { createSession, findSession, type SessionUser } from './session';

const DIR = mkdtempSync(path.join(tmpdir(), 'ib-admin-'));
process.env.IB_DATA_DIR = DIR;
process.env.AUTH_MODE = 'local';
(process.env as Record<string, string>).NODE_ENV = 'test';
delete process.env.DATABASE_URL;
mkdirSync(path.join(DIR, 'secrets'), { recursive: true });

const aiFile = path.join(DIR, 'secrets', 'ai.json');
const KEY = 'sk-ant-ADMINTEST-0123456789abcdef';
const HEADER_VALUE = 'proj-secret-value-42';

let db: Db;
let provider: Server;
let providerUrl = '';
let reply: { status: number; body: unknown } | null = null;
let n = 0;

before(async () => {
  provider = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const r = reply ?? {
        status: 200,
        body: {
          id: 'msg_t',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: 'OK' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      };
      res.writeHead(r.status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  db = await getDb();
});

after(async () => {
  await db?.close();
  provider?.close();
  rmSync(DIR, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(aiFile, { force: true });
  reply = null;
  resetAiTests();
});

const local = (role: 'maker' | 'curator' | 'admin' = 'maker', name = `คน ${++n}`) =>
  db.tx((sql) => createLocalUser(sql, { username: `u${++n}-${role}`, name, password: 'a-good-password', role }));
const cookieOf = async (u: SessionUser) => `ib_sid=${await createSession(db, u.id)}`;

/** a route call as a browser on our page makes it */
function call(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  method: string,
  url: string,
  opts: { cookie?: string; body?: unknown; id?: string } = {},
) {
  const headers: Record<string, string> = { 'x-ib-req': '1', 'sec-fetch-site': 'same-origin' };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`http://localhost${url}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return handler(req, { params: Promise.resolve({ id: opts.id ?? '' }) });
}
const codeOf = async (res: Response) => ((await res.json()) as { error?: string }).error;
const isCode = (code: string) => (e: unknown) => e instanceof HttpError && e.code === code;

// ---------- roles and permissions ----------

test('upgrading gives the old curators the admin role and everyone else maker, with every feature on', async () => {
  const old = await openPglite(undefined, 'icebreaker');
  try {
    await migrate(old, SCHEMA_VERSION - 1);
    await old.exec(`
      INSERT INTO ib_users (id, issuer, subject, display_name, is_curator) VALUES
        ('ua', 't', 'a', 'A', true), ('ub', 't', 'b', 'B', false);
    `);
    await migrate(old);
    const rows = await old.query<{ id: string; role: string; perms: unknown; is_curator: boolean }>('SELECT id, role, perms, is_curator FROM ib_users ORDER BY id');
    assert.deepEqual(
      rows.map((r) => [r.id, r.role, readPerms(r.perms), r.is_curator]),
      [
        ['ua', 'admin', { share: true, aiQuiz: true, pika: true }, true],
        ['ub', 'maker', { share: true, aiQuiz: true, pika: true }, false],
      ],
    );
    await assert.rejects(old.query("UPDATE ib_users SET role = 'owner' WHERE id = 'ua'"), 'only the three roles');
    await migrate(old); // nothing left to do
  } finally {
    await old.close();
  }
});

test('permissions store only what is off, so a feature added later starts on', () => {
  assert.deepEqual(readPerms({}), { share: true, aiQuiz: true, pika: true });
  assert.deepEqual(readPerms(null), { share: true, aiQuiz: true, pika: true });
  assert.deepEqual(readPerms({ share: false, pika: 'no', later: false }), { share: false, aiQuiz: true, pika: true });
  assert.deepEqual(storedPerms({ share: false, aiQuiz: true, pika: false }), { share: false, pika: false });
  assert.deepEqual(storedPerms({ share: true, aiQuiz: true, pika: true }), {});
});

test('a change is read field by field; anything unknown or of the wrong kind is refused', () => {
  assert.deepEqual(readPatch({ role: 'curator' }), { role: 'curator' });
  assert.deepEqual(readPatch({ can: { share: false } }), { can: { share: false } });
  assert.deepEqual(readPatch({ email: null }), { email: null });
  for (const body of [{}, { role: 'owner' }, { can: { delete: true } }, { can: { share: 'no' } }, { can: [] }, { disabled: 'yes' }, { name: 5 }, { email: 5 }]) {
    assert.throws(() => readPatch(body), isCode('bad_field'), JSON.stringify(body));
  }
  assert.deepEqual(readNewUser({ username: 'x', name: 'X', password: 'generate' }), { username: 'x', name: 'X', password: 'generate', email: null, role: 'maker' });
  assert.throws(() => readNewUser({ username: 'x', name: 'X', password: 'none' }), isCode('bad_field'), 'company login only needs an email');
  assert.throws(() => readNewUser({ username: 'x', name: 'X', password: 'hunter2' }), isCode('bad_field'), 'an admin never picks the password');
  assert.throws(() => readNewUser({ username: 'x', name: 'X', password: 'generate', role: 'root' }), isCode('bad_field'));
});

test('an admin makes an account with a password shown once, and it logs in with it', async () => {
  const admin = await local('admin');
  const made = await createUser(db, admin, { username: 'New.Person', name: '  คนใหม่  ', password: 'generate', email: 'New.Person@Example.com', role: 'curator' });
  assert.ok(made.password && made.password.length >= 16);
  assert.equal(made.user.username, 'new.person');
  assert.equal(made.user.name, 'คนใหม่');
  assert.equal(made.user.email, 'new.person@example.com');
  assert.equal(made.user.role, 'curator');
  assert.equal(made.user.hasPassword, true);
  assert.equal(made.user.lastLoginAt, null, 'nobody has used it yet');
  resetLoginThrottle();
  const login = await checkLocalLogin(db, 'NEW.PERSON', made.password!);
  assert.equal(login?.id, made.user.id);
  assert.equal(login?.role, 'curator');

  const sso = await createUser(db, admin, { username: 'sso-only', name: 'SSO', password: 'none', email: 'sso.only@example.com', role: 'maker' });
  assert.equal(sso.password, null);
  assert.equal(sso.user.hasPassword, false);

  await assert.rejects(createUser(db, admin, { username: 'new.person', name: 'ชื่อซ้ำ', password: 'generate', email: null, role: 'maker' }), isCode('username_taken'));
  // the same email on two accounts would let one log in as the other through the company login
  await assert.rejects(createUser(db, admin, { username: 'other.one', name: 'อีเมลซ้ำ', password: 'generate', email: 'new.person@example.com', role: 'maker' }));
  assert.equal((await listUsers(db, 'other.one')).matched, 0, 'nothing half made');
});

test('roles and permissions change at once, take effect on the next request, and are logged', async () => {
  const admin = await local('admin', 'ผู้ดูแล');
  const maker = await local('maker', 'คนทำเกม');
  const cookie = await cookieOf(maker);

  const up = await updateUser(db, admin, maker.id, { role: 'curator', can: { share: false } });
  assert.equal(up.role, 'curator');
  assert.deepEqual(up.can, { share: false, aiQuiz: true, pika: true });
  const [row] = await db.query<{ perms: unknown; is_curator: boolean }>('SELECT perms, is_curator FROM ib_users WHERE id = $1', [maker.id]);
  assert.deepEqual(row!.perms, { share: false });
  assert.equal(row!.is_curator, true, 'kept in step for older code paths');

  // the session already open sees it: /me says so, and sharing is refused
  const me = (await (await call(meRoute.GET, 'GET', '/api/auth/me', { cookie })).json()) as { user: { role: string; can: Record<string, boolean> } };
  assert.equal(me.user.role, 'curator');
  assert.equal(me.user.can.share, false);
  const g = await createGame(db, maker.id, structuredClone(SAMPLE_GAMES[0]!), 'sample');
  const refused = await call(catalogRoute.POST, 'POST', '/api/catalog', { cookie, body: { gameId: g.id } });
  assert.equal(refused.status, 403);
  assert.equal(await codeOf(refused), 'not_permitted');

  await updateUser(db, admin, maker.id, { can: { share: true }, role: 'maker' });
  const [back] = await db.query<{ perms: unknown; is_curator: boolean }>('SELECT perms, is_curator FROM ib_users WHERE id = $1', [maker.id]);
  assert.deepEqual(back!.perms, {});
  assert.equal(back!.is_curator, false);
  assert.equal((await call(catalogRoute.POST, 'POST', '/api/catalog', { cookie, body: { gameId: g.id } })).status, 201);

  const log = (await recentChanges(db, 50)).filter((c) => c.target === 'คนทำเกม' && c.actor === 'ผู้ดูแล').map((c) => c.action);
  assert.deepEqual(log.sort(), ['admin_perms_set', 'admin_perms_set', 'admin_role_set', 'admin_role_set']);
});

test('nobody locks themself out, and the last admin who can log in stays one', async () => {
  // a fresh database for this one: the count of admins must be ours alone
  await db.query("UPDATE ib_users SET role = 'maker', is_curator = false WHERE role <> 'maker'");
  const a = await local('admin');
  const b = await local('admin');

  await assert.rejects(updateUser(db, a, a.id, { role: 'maker' }), isCode('self_change'));
  await assert.rejects(updateUser(db, a, a.id, { disabled: true }), isCode('self_change'));
  // keeping your own role, or changing your own permissions, is fine
  assert.equal((await updateUser(db, a, a.id, { role: 'admin', can: { pika: false } })).can.pika, false);
  await updateUser(db, a, a.id, { can: { pika: true } });

  // b is disabled: its sessions end, and a is now the only admin who can log in
  const bToken = await createSession(db, b.id);
  await updateUser(db, a, b.id, { disabled: true });
  assert.equal(await findSession(db, bToken), null);
  assert.equal((await db.query('SELECT 1 FROM ib_sessions WHERE user_id = $1', [b.id])).length, 0);
  // a request b had already started, carrying b as an admin, can't take a's role or account away
  await assert.rejects(updateUser(db, b, a.id, { role: 'curator' }), isCode('last_admin'));
  await assert.rejects(updateUser(db, b, a.id, { disabled: true }), isCode('last_admin'));

  // with a second admin who can log in, a may step down... but not by their own hand
  const c = await local('admin');
  assert.equal((await updateUser(db, c, a.id, { role: 'maker' })).role, 'maker');
  await updateUser(db, c, a.id, { role: 'admin' });
});

test("a company-login account keeps its own name and email; ours can't be renamed through it", async () => {
  const admin = await local('admin');
  const sso = await upsertUser(db, { issuer: 'https://sso.example.com/realms/x', subject: `s-${++n}`, name: 'From SSO', email: 'sso@example.com' });
  await assert.rejects(updateUser(db, admin, sso.id, { name: 'Renamed' }), isCode('not_local'));
  await assert.rejects(updateUser(db, admin, sso.id, { email: 'x@example.com' }), isCode('not_local'));
  await assert.rejects(resetPassword(db, admin, sso.id), isCode('not_local'));
  // its role and permissions are still ours to set
  assert.equal((await updateUser(db, admin, sso.id, { role: 'curator' })).role, 'curator');
  const listed = (await listUsers(db, 'From SSO')).users[0]!;
  assert.equal(listed.kind, 'sso');
  assert.equal(listed.username, null);
  await assert.rejects(updateUser(db, admin, 'no-such-id-000000000000', { role: 'maker' }), isCode('not_found'));
});

test('a new password ends every session; ending sessions logs out everywhere', async () => {
  const admin = await local('admin');
  const u = await local('maker');
  const t1 = await createSession(db, u.id);
  const t2 = await createSession(db, u.id);
  const reset = await resetPassword(db, admin, u.id);
  assert.equal(reset.password.length, 16);
  assert.equal(await findSession(db, t1), null);
  assert.equal(await findSession(db, t2), null);
  resetLoginThrottle();
  await assert.rejects(checkLocalLogin(db, reset.user.username!, 'a-good-password'), isCode('bad_login'), 'the old password stops working');
  assert.equal((await checkLocalLogin(db, reset.user.username!, reset.password))?.id, u.id);

  await createSession(db, u.id);
  await createSession(db, u.id);
  assert.equal(await endSessions(db, admin, u.id), 2);
  assert.equal(await endSessions(db, admin, u.id), 0);
});

test('only an admin gets an answer from /api/admin, and a maker or a stranger gets nothing', async () => {
  const admin = await local('admin');
  const maker = await local('maker');
  const curator = await local('curator');
  const target = await local('maker');
  const routes: [Parameters<typeof call>[0], string, string, unknown?][] = [
    [usersRoute.GET, 'GET', '/api/admin/users'],
    [usersRoute.POST, 'POST', '/api/admin/users', { username: `x${++n}`, name: 'ไม่ควรเกิด', password: 'generate' }],
    [userRoute.PATCH, 'PATCH', `/api/admin/users/${target.id}`, { role: 'admin' }],
    [passwordRoute.POST, 'POST', `/api/admin/users/${target.id}/password`, {}],
    [sessionsRoute.DELETE, 'DELETE', `/api/admin/users/${target.id}/sessions`],
    [overviewRoute.GET, 'GET', '/api/admin/overview'],
    [aiRoute.GET, 'GET', '/api/admin/ai'],
    [aiRoute.PUT, 'PUT', '/api/admin/ai', { apiKey: 'sk-should-never-be-saved' }],
    [aiTestRoute.POST, 'POST', '/api/admin/ai/test', {}],
  ];
  for (const [who, cookie, status, code] of [
    ['maker', await cookieOf(maker), 403, 'admin_only'],
    ['curator', await cookieOf(curator), 403, 'admin_only'],
    ['stranger', undefined, 401, 'login_required'],
  ] as const) {
    for (const [h, method, url, body] of routes) {
      const res = await call(h, method, url, { cookie, body, id: target.id });
      assert.equal(res.status, status, `${who} ${method} ${url}`);
      assert.equal(await codeOf(res), code);
    }
  }
  const [t] = await db.query<{ role: string }>('SELECT role FROM ib_users WHERE id = $1', [target.id]);
  assert.equal(t!.role, 'maker', 'nothing changed');
  assert.equal(readFileSafe(aiFile), null, 'nothing saved');

  // the same calls as an admin
  const cookie = await cookieOf(admin);
  const list = await call(usersRoute.GET, 'GET', '/api/admin/users?q=' + encodeURIComponent(target.name), { cookie });
  assert.equal(list.status, 200);
  const text = await list.text();
  assert.ok(text.includes(target.id));
  assert.doesNotMatch(text, /"hash"|scrypt|"password"/i, 'no password material in the list');
  const overview = await call(overviewRoute.GET, 'GET', '/api/admin/overview', { cookie });
  assert.equal(overview.status, 200);
  // a change without our header is refused, as everywhere
  const noHeader = await userRoute.PATCH(
    new Request(`http://localhost/api/admin/users/${target.id}`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: '{"role":"admin"}' }),
    { params: Promise.resolve({ id: target.id }) },
  );
  assert.equal(noHeader.status, 403);
  const made = await call(usersRoute.POST, 'POST', '/api/admin/users', { cookie, body: { username: `made${++n}`, name: 'ทำโดยแอดมิน', password: 'generate' } });
  assert.equal(made.status, 201);
  assert.match(((await made.json()) as { password: string }).password, /^[A-Za-z0-9]{16}$/);
});

test('the list says how people log in, and a site with only company login hands out no passwords', async () => {
  const admin = await local('admin');
  const kept = `kept${++n}`;
  const target = await db.tx((sql) => createLocalUser(sql, { username: kept, name: 'รหัสเดิม', password: 'a-good-password' }));
  const cookie = await cookieOf(admin);
  const ways = async () => ((await (await call(usersRoute.GET, 'GET', '/api/admin/users', { cookie })).json()) as { login: unknown }).login;
  const kc = { KEYCLOAK_ISSUER: 'http://127.0.0.1:9/realms/test', KEYCLOAK_CLIENT_ID: 'pika-arena', KEYCLOAK_CLIENT_SECRET: 'unit-test-secret-0000' };
  assert.deepEqual(await ways(), { passwords: true, company: false }, 'local without Keycloak: passwords only');
  try {
    Object.assign(process.env, kc);
    assert.deepEqual(await ways(), { passwords: true, company: true }, 'local with Keycloak: both');
    process.env.AUTH_MODE = 'oidc';
    assert.deepEqual(await ways(), { passwords: false, company: true }, 'oidc: company login only');

    const made = await call(usersRoute.POST, 'POST', '/api/admin/users', { cookie, body: { username: `pw${++n}`, name: 'มีรหัสไม่ได้', password: 'generate' } });
    assert.equal(made.status, 409);
    assert.equal(await codeOf(made), 'no_passwords');
    const reset = await call(passwordRoute.POST, 'POST', `/api/admin/users/${target.id}/password`, { cookie, body: {}, id: target.id });
    assert.equal(reset.status, 409);
    assert.equal(await codeOf(reset), 'no_passwords');
    assert.equal((await checkLocalLogin(db, kept, 'a-good-password')).id, target.id, 'the old password was not touched');

    const company = await call(usersRoute.POST, 'POST', '/api/admin/users', {
      cookie,
      body: { username: `co${++n}`, name: 'บัญชีบริษัท', email: `co${n}@example.com`, password: 'none' },
    });
    assert.equal(company.status, 201, 'a company-login account is still made');
    assert.equal(((await company.json()) as { password: unknown }).password, null);
  } finally {
    process.env.AUTH_MODE = 'local';
    for (const k of Object.keys(kc)) delete process.env[k];
  }
});

function readFileSafe(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// ---------- the AI settings ----------

test('the AI form merges onto the file: a blank key keeps it, a new one replaces it, clearKey removes it', () => {
  const raw = { apiKey: KEY, model: 'm1', headers: { 'X-Project': HEADER_VALUE }, someFutureField: { a: 1 } };
  assert.equal(mergeAiSettings(raw, { apiKey: '' }).apiKey, KEY);
  assert.equal(mergeAiSettings(raw, { apiKey: null }).apiKey, KEY);
  assert.equal(mergeAiSettings(raw, {}).apiKey, KEY);
  assert.equal(mergeAiSettings(raw, { apiKey: '  sk-new-key  ' }).apiKey, 'sk-new-key');
  assert.equal('apiKey' in mergeAiSettings(raw, { clearKey: true, apiKey: 'ignored' }), false);
  assert.deepEqual(mergeAiSettings(raw, { model: 'm2' }).someFutureField, { a: 1 }, 'fields the page does not know stay');
  for (const k of ['has space', 'line\nbreak', 'x'.repeat(1001)]) assert.throws(() => mergeAiSettings(raw, { apiKey: k }), isCode('bad_field'));

  // headers: the list is the whole set; no value keeps the saved one
  assert.deepEqual(mergeAiSettings(raw, { headers: [{ name: 'X-Project', value: null }] }).headers, { 'X-Project': HEADER_VALUE });
  assert.deepEqual(mergeAiSettings(raw, { headers: [{ name: 'x-project', value: '' }] }).headers, { 'x-project': HEADER_VALUE }, 'any case');
  assert.deepEqual(mergeAiSettings(raw, { headers: [{ name: 'X-Project', value: 'new' }, { name: 'X-Team', value: 'qa' }] }).headers, { 'X-Project': 'new', 'X-Team': 'qa' });
  assert.equal('headers' in mergeAiSettings(raw, { headers: [] }), false);
  for (const headers of [
    [{ name: 'X-New', value: null }], // nothing saved to keep
    [{ name: 'X-A', value: '1' }, { name: 'x-a', value: '2' }],
    [{ name: 'Content-Type', value: 'text/plain' }],
    [{ name: 'anthropic-version', value: '1' }],
    [{ name: 'bad name', value: '1' }],
    [{ name: 'X-A', value: 'line\nbreak' }],
    Array.from({ length: 11 }, (_, i) => ({ name: `X-${i}`, value: '1' })),
    'X-A: 1',
  ]) {
    assert.throws(() => mergeAiSettings(raw, { headers }), isCode('bad_field'), JSON.stringify(headers));
  }

  // the address: http(s), no password, query or fragment; the trailing slash goes
  assert.equal(mergeAiSettings(raw, { baseUrl: 'https://gw.example.com/v1/' }).baseUrl, 'https://gw.example.com/v1');
  assert.equal('baseUrl' in mergeAiSettings({ ...raw, baseUrl: 'https://x' }, { baseUrl: '' }), false);
  for (const u of ['ftp://gw.example.com', 'https://user:pw@gw.example.com', 'https://gw.example.com/?key=1', 'not a url', 5]) {
    assert.throws(() => mergeAiSettings(raw, { baseUrl: u }), isCode('bad_field'), String(u));
  }
  // numbers within the page's limits, and only the listed choices
  assert.equal(mergeAiSettings(raw, { maxTokens: 256 }).maxTokens, 256);
  for (const body of [{ maxTokens: 255 }, { maxTokens: 16001 }, { maxTokens: 1.5 }, { perDay: 0 }, { quizPerPersonPerDay: '10' }, { effort: 'max' }, { who: 'everyone' }, { enabled: 'false' }, { model: 'bad model' }, { model: '' }]) {
    assert.throws(() => mergeAiSettings(raw, body), isCode('bad_field'), JSON.stringify(body));
  }
});

test('saving writes the file whole and at once, and nothing that reads it back holds a secret', async () => {
  assert.deepEqual(
    { configured: aiSettingsView().configured, apiKeySet: aiSettingsView().apiKeySet, live: aiSettingsView().live },
    { configured: false, apiKeySet: false, live: false },
  );
  const first = await saveAiSettings({ apiKey: KEY, baseUrl: providerUrl, model: 'claude-opus-5-5', headers: [{ name: 'X-Project', value: HEADER_VALUE }], perPersonPerDay: 12 });
  assert.deepEqual(first.changed, ['apiKey', 'baseUrl', 'headers', 'model', 'perPersonPerDay']);
  const file = JSON.parse(readFileSync(aiFile, 'utf8')) as Record<string, unknown>;
  assert.equal(file.apiKey, KEY);
  assert.deepEqual(file.headers, { 'X-Project': HEADER_VALUE });
  if (process.platform !== 'win32') assert.equal(statSync(aiFile).mode & 0o777, 0o600);

  const view = JSON.stringify(first.view);
  assert.ok(!view.includes(KEY) && !view.includes(HEADER_VALUE));
  assert.equal(first.view.apiKeySet, true);
  assert.deepEqual(first.view.headerNames, ['X-Project']);
  assert.equal(first.view.live, true, 'AI is on at once, no restart');
  assert.equal(aiConfig()?.perPersonPerDay, 12);

  // turned off: the key stays, AI stops
  const off = await saveAiSettings({ enabled: false });
  assert.deepEqual(off.changed, ['enabled']);
  assert.equal(off.view.live, false);
  assert.equal(aiConfig(), null);
  assert.equal(aiConfig({ evenIfOff: true })?.apiKey, KEY);
  await saveAiSettings({ enabled: true });

  // two saves at once both land, one after the other
  await Promise.all([saveAiSettings({ perDay: 500 }), saveAiSettings({ maxTokens: 2000 })]);
  const both = JSON.parse(readFileSync(aiFile, 'utf8')) as Record<string, unknown>;
  assert.equal(both.perDay, 500);
  assert.equal(both.maxTokens, 2000);
  assert.equal(both.apiKey, KEY);

  // a refused save leaves the file as it was
  const before = readFileSync(aiFile, 'utf8');
  await assert.rejects(saveAiSettings({ maxTokens: 1, apiKey: 'sk-other' }), isCode('bad_field'));
  assert.equal(readFileSync(aiFile, 'utf8'), before);

  // a broken file is reported, and a save writes a good one over it
  writeFileSync(aiFile, '{not json');
  assert.equal(aiSettingsView().problem, 'bad_json');
  await saveAiSettings({ apiKey: KEY, model: 'm' });
  assert.equal(aiSettingsView().problem, null);
});

test('the admin routes save and show the settings, and no answer holds the key or a header value', async () => {
  const admin = await local('admin', 'แอดมิน AI');
  const cookie = await cookieOf(admin);
  const put = await call(aiRoute.PUT, 'PUT', '/api/admin/ai', {
    cookie,
    body: { apiKey: KEY, baseUrl: providerUrl, headers: [{ name: 'X-Project', value: HEADER_VALUE }], fallbacks: false },
  });
  assert.equal(put.status, 200);
  const answers = [await put.text()];
  answers.push(await (await call(aiRoute.GET, 'GET', '/api/admin/ai', { cookie })).text());
  answers.push(await (await call(overviewRoute.GET, 'GET', '/api/admin/overview', { cookie })).text());
  const tested = await call(aiTestRoute.POST, 'POST', '/api/admin/ai/test', { cookie, body: {} });
  assert.equal(tested.status, 200);
  const t = (await tested.json()) as { result: { ok: boolean; reply?: string } };
  answers.push(JSON.stringify(t));
  assert.equal(t.result.ok, true);
  assert.equal(t.result.reply, 'OK');
  for (const a of answers) {
    assert.ok(!a.includes(KEY), 'no key');
    assert.ok(!a.includes(HEADER_VALUE), 'no header value');
  }
  // the log says what changed, never the value
  const [row] = await db.query<{ detail: unknown }>("SELECT detail FROM ib_audit_log WHERE action = 'ai_settings_saved' ORDER BY at DESC, id DESC LIMIT 1");
  assert.ok(!JSON.stringify(row?.detail).includes(KEY));
  assert.ok((await recentChanges(db)).some((c) => c.action === 'ai_settings_saved' && c.actor === 'แอดมิน AI'));
});

test('the connection test hides a key or header value the provider echoes back, and needs a key first', async () => {
  await assert.rejects(testAi(), isCode('ai_not_set'));
  writeFileSync(aiFile, JSON.stringify({ apiKey: KEY, baseUrl: providerUrl, fallbacks: false, headers: { 'X-Project': HEADER_VALUE } }));
  reply = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY} for project ${HEADER_VALUE}` } } };
  const r = await testAi();
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 401);
  assert.ok(!r.ok && !r.message.includes(KEY) && !r.message.includes(HEADER_VALUE), !r.ok ? r.message : '');

  // works while AI is turned off, so an admin can check before turning it on
  writeFileSync(aiFile, JSON.stringify({ apiKey: KEY, baseUrl: providerUrl, enabled: false }));
  reply = null;
  assert.equal((await testAi()).ok, true);

  // at most 10 a minute
  resetAiTests();
  const now = Date.now();
  for (let i = 0; i < 10; i++) await testAi(now);
  await assert.rejects(testAi(now), isCode('rate_limited'));
  assert.equal((await testAi(now + 61_000)).ok, true);
});
