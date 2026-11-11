import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { ssoSource, type SsoConfig } from './config';
import { migrate, openPglite, type Db } from './db';
import { HttpError } from './http';
import { SsoError, emailFrom, findSsoUser, newFlow, openFlow, pickKey, safeNext, sealFlow, verifyIdToken, type Jwk } from './keycloak';
import { createLocalUser, setLocalEmail, usernameFromEmail } from './local-users';

const ISSUER = 'https://kc.example.test/realms/mfec';
const CLIENT = 'pika-arena';
const cfg: SsoConfig = { issuer: ISSUER, clientId: CLIENT, clientSecret: 'test-secret-0123456789', appUrl: null, idpHint: 'entra', from: 'env' };

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = (k: KeyObject, kid: string, extra: Partial<Jwk> = {}): Jwk => ({ ...(k.export({ format: 'jwk' }) as Jwk), kid, use: 'sig', ...extra });
const KEYS: Jwk[] = [
  // an encryption key first, as Keycloak lists one: never used to check a signature
  jwk(other.publicKey, 'rs1', { use: 'enc', alg: 'RSA-OAEP' }),
  jwk(rsa.publicKey, 'rs1', { alg: 'RS256' }),
  jwk(rsa.publicKey, 'ps1'),
  jwk(ec.publicKey, 'ec1'),
];

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const good = { iss: ISSUER, aud: CLIENT, sub: 'u-1', exp: now + 300, iat: now, nonce: 'n-1', email: 'Somchai.J@Example.co.th' };

function token(claims: Record<string, unknown>, opts: { alg?: string; kid?: string; key?: KeyObject; header?: Record<string, unknown> } = {}) {
  const alg = opts.alg ?? 'RS256';
  const head = b64({ alg, kid: opts.kid ?? 'rs1', typ: 'JWT', ...opts.header });
  const input = Buffer.from(`${head}.${b64(claims)}`);
  let sig: Buffer;
  if (alg === 'RS256') sig = sign('sha256', input, opts.key ?? rsa.privateKey);
  else if (alg === 'PS256') sig = sign('sha256', input, { key: opts.key ?? rsa.privateKey, padding: 6, saltLength: 32 });
  else if (alg === 'ES256') sig = sign('sha256', input, { key: opts.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' });
  else sig = Buffer.alloc(0);
  return `${input}.${sig.toString('base64url')}`;
}

const check = (t: string, nonce = 'n-1') =>
  verifyIdToken(t, { issuer: ISSUER, clientId: CLIENT, nonce, keyFor: async (kid, alg) => pickKey(KEYS, kid, alg) });

const refused = async (t: string, why: RegExp, nonce?: string) => {
  await assert.rejects(check(t, nonce), (e: unknown) => e instanceof SsoError && why.test(e.message));
};

test('a token Keycloak signed for this client and this login is accepted', async () => {
  assert.equal((await check(token(good))).sub, 'u-1');
  assert.equal((await check(token(good, { alg: 'PS256', kid: 'ps1' }))).sub, 'u-1');
  assert.equal((await check(token(good, { alg: 'ES256', kid: 'ec1' }))).sub, 'u-1');
  // several audiences are fine when it names us as the party it was issued to
  assert.equal((await check(token({ ...good, aud: [CLIENT, 'account'], azp: CLIENT }))).sub, 'u-1');
  // a little clock difference is allowed
  assert.equal((await check(token({ ...good, exp: now - 30 }))).sub, 'u-1');
});

test('forged, borrowed, old or replayed tokens are refused', async () => {
  await refused(token(good, { key: other.privateKey }), /bad signature/);
  // the payload changed after signing
  const [h, , s] = token(good).split('.');
  await refused(`${h}.${b64({ ...good, email: 'boss@example.co.th' })}.${s}`, /bad signature/);
  await refused(token(good, { alg: 'none' }), /not accepted/);
  await refused(token(good, { alg: 'HS256' }), /not accepted/);
  await refused(token(good, { kid: 'nobody' }), /no key/);
  await refused(token(good, { header: { crit: ['exp'] } }), /crit/);
  await refused(token({ ...good, aud: 'another-app' }), /not for this client/);
  await refused(token({ ...good, aud: [CLIENT, 'account'] }), /azp/);
  await refused(token({ ...good, azp: 'another-app' }), /azp/);
  await refused(token({ ...good, iss: 'https://kc.example.test/realms/other' }), /issuer/);
  await refused(token({ ...good, exp: now - 120 }), /expired/);
  await refused(token({ ...good, iat: now + 600 }), /future/);
  await refused(token(good), /nonce/, 'n-2');
  await refused(token({ ...good, nonce: undefined }), /nonce/);
  await refused(token({ ...good, sub: '' }), /sub/);
  await refused('not.a.jwt!', /not a JWT/);
  await refused('abc', /not a JWT/);
});

test('only signing keys of the right kind are picked', () => {
  assert.equal(pickKey(KEYS, 'rs1', 'RS256')?.asymmetricKeyType, 'rsa');
  assert.equal(pickKey(KEYS, 'ec1', 'RS256'), null);
  assert.equal(pickKey(KEYS, 'ec1', 'ES384'), null); // P-256, not P-384
  assert.equal(pickKey([jwk(rsa.publicKey, 'x', { use: 'enc' })], 'x', 'RS256'), null);
  assert.equal(pickKey(KEYS, 'rs1', 'HS256'), null);
  // a private key in the list is read as its public part only
  const priv = { ...(rsa.privateKey.export({ format: 'jwk' }) as Jwk), kid: 'p', use: 'sig' };
  assert.equal(pickKey([priv], 'p', 'RS256')?.type, 'public');
});

test('the login in progress is sealed: tampered, foreign or old cookies are refused', () => {
  const flow = newFlow('/editor?id=1');
  const sealed = sealFlow(cfg, flow);
  assert.deepEqual(openFlow(cfg, sealed), flow);
  const [body, mac] = sealed.split('.');
  const other = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8'));
  other.next = '/host';
  assert.equal(openFlow(cfg, `${b64(other)}.${mac}`), null);
  assert.equal(openFlow({ ...cfg, clientSecret: 'another-secret-012345' }, sealed), null);
  assert.equal(openFlow(cfg, `${sealed}.x`), null);
  assert.equal(openFlow(cfg, body!), null);
  assert.equal(openFlow(cfg, ''), null);
  assert.equal(openFlow(cfg, null), null);
  assert.equal(openFlow(cfg, sealed, flow.at + 11 * 60 * 1000), null);
  // every login gets its own state, nonce and verifier
  const again = newFlow('/host');
  assert.notEqual(again.state, flow.state);
  assert.notEqual(again.nonce, flow.nonce);
  assert.match(again.verifier, /^[\w-]{43}$/);
});

test('the email comes from email, else preferred_username, in lower case', () => {
  assert.equal(emailFrom({ email: ' Somchai.J@Example.co.th ' }), 'somchai.j@example.co.th');
  assert.equal(emailFrom({ preferred_username: 'Nok@Example.co.th' }), 'nok@example.co.th');
  assert.equal(emailFrom({ email: '', preferred_username: 'nok@example.co.th' }), 'nok@example.co.th');
  assert.equal(emailFrom({ preferred_username: 'nok' }), null);
  assert.equal(emailFrom({ email: 'a b@example.co.th' }), null);
  assert.equal(emailFrom({}), null);
});

test('next stays a path on this site', () => {
  assert.equal(safeNext('/editor?id=1'), '/editor?id=1');
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'host', '/a\nb', '/a\\b', null, 7, `/${'x'.repeat(600)}`]) assert.equal(safeNext(bad), '/host');
});

test('a username for an invited email', () => {
  assert.equal(usernameFromEmail('Somchai.J@example.co.th'), 'somchai.j');
  assert.equal(usernameFromEmail('o+brien@example.co.th'), 'o-brien');
  assert.equal(usernameFromEmail('ab@example.co.th'), null); // too short for a username
});

// ---------- settings ----------

const ENV = ['KEYCLOAK_ISSUER', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET', 'AUTH_URL', 'IB_DATA_DIR', 'NODE_ENV'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
let dir: string;
function setEnv(values: Partial<Record<(typeof ENV)[number], string>>) {
  for (const k of ENV) delete process.env[k];
  process.env.IB_DATA_DIR = dir;
  Object.assign(process.env, values);
}

test('settings: from the environment on a laptop, checked', () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ib-sso-'));
  try {
    setEnv({});
    assert.deepEqual(ssoSource(), { config: null, from: null, problem: null });
    const base = { KEYCLOAK_ISSUER: `${ISSUER}/`, KEYCLOAK_CLIENT_ID: CLIENT, KEYCLOAK_CLIENT_SECRET: 'test-secret-0123456789' };
    setEnv(base);
    const ok = ssoSource().config!;
    assert.equal(ok.issuer, ISSUER); // the slash at the end is gone
    assert.equal(ok.appUrl, null);
    assert.equal(ok.idpHint, 'entra');
    setEnv({ ...base, AUTH_URL: 'http://localhost:3000/' });
    assert.equal(ssoSource().config!.appUrl, 'http://localhost:3000');
    setEnv({ ...base, KEYCLOAK_ISSUER: 'http://kc.example.test/realms/mfec' });
    assert.match(ssoSource().problem!, /https/);
    setEnv({ ...base, KEYCLOAK_ISSUER: 'http://127.0.0.1:9999/realms/mfec' });
    assert.ok(ssoSource().config);
    setEnv({ ...base, KEYCLOAK_CLIENT_SECRET: '' });
    assert.match(ssoSource().problem!, /clientSecret/);
    setEnv({ ...base, AUTH_URL: 'https://dmhub.example.test/PikaArena' });
    assert.match(ssoSource().problem!, /site only/);
    setEnv({ ...base, KEYCLOAK_ISSUER: `${ISSUER}?x=1` });
    assert.match(ssoSource().problem!, /query/);
    // production: https only, and the site address is required
    setEnv({ ...base, NODE_ENV: 'production' });
    assert.match(ssoSource().problem!, /appUrl is required/);
    setEnv({ ...base, NODE_ENV: 'production', AUTH_URL: 'http://localhost:3000' });
    assert.match(ssoSource().problem!, /https/);
  } finally {
    setEnv({});
  }
});

test('settings: var/secrets/keycloak.json wins over the environment', () => {
  try {
    mkdirSync(path.join(dir, 'secrets'), { recursive: true });
    const file = path.join(dir, 'secrets', 'keycloak.json');
    setEnv({ KEYCLOAK_ISSUER: 'https://elsewhere.example.test/realms/x', KEYCLOAK_CLIENT_ID: 'x', KEYCLOAK_CLIENT_SECRET: 'xxxxxxxxxxxx' });
    writeFileSync(file, JSON.stringify({ issuer: ISSUER, clientId: CLIENT, clientSecret: 'file-secret-0123456789', appUrl: 'https://dmhub.example.test', idpHint: '' }));
    const c = ssoSource().config!;
    assert.equal(c.from, 'var/secrets/keycloak.json');
    assert.equal(c.issuer, ISSUER);
    assert.equal(c.appUrl, 'https://dmhub.example.test');
    assert.equal(c.idpHint, '');
    writeFileSync(file, '{ not json');
    const bad = ssoSource();
    assert.equal(bad.config, null);
    assert.match(bad.problem!, /not a JSON object/);
    // the secret never shows up in a problem
    writeFileSync(file, JSON.stringify({ issuer: ISSUER, clientId: CLIENT, clientSecret: 'file-secret-0123456789', appUrl: 'ftp://x' }));
    assert.doesNotMatch(ssoSource().problem!, /file-secret/);
  } finally {
    setEnv({});
    // process.env.NODE_ENV is typed read-only; Object.assign puts the saved values back without a cast
    for (const k of ENV) delete process.env[k];
    Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- who gets in ----------

let db: Db;
before(async () => {
  db = await openPglite(undefined, 'icebreaker');
  await migrate(db);
});
after(() => db?.close());

test('company login finds the account by its work email, in any case, and nobody else', async () => {
  await db.tx(async (sql) => {
    await createLocalUser(sql, { username: 'somchai', name: 'สมชาย', password: null });
    await setLocalEmail(sql, 'somchai', 'Somchai.J@Example.co.th');
  });
  const u = await db.tx((sql) => findSsoUser(sql, 'SOMCHAI.J@example.co.th'));
  assert.equal(u.name, 'สมชาย');
  assert.equal(u.email, 'somchai.j@example.co.th');

  const code = async (email: string) => {
    try {
      await db.tx((sql) => findSsoUser(sql, email));
      return 'ok';
    } catch (e) {
      assert.ok(e instanceof HttpError);
      return `${e.status} ${e.code}`;
    }
  };
  assert.equal(await code('stranger@example.co.th'), '403 no_account');

  await db.query("UPDATE ib_users SET disabled = true WHERE subject = 'somchai'");
  assert.equal(await code('somchai.j@example.co.th'), '403 account_disabled');
  await db.query("UPDATE ib_users SET disabled = false WHERE subject = 'somchai'");

  // two accounts with one email (only possible by hand in the database): refuse rather than guess
  await db.tx((sql) => createLocalUser(sql, { username: 'somchai2', name: 'สมชาย สอง', password: null }));
  await db.query("UPDATE ib_users SET email = 'SOMCHAI.J@example.co.th' WHERE subject = 'somchai2'");
  assert.equal(await code('somchai.j@example.co.th'), '403 no_account');
  await db.query("UPDATE ib_users SET email = NULL WHERE subject = 'somchai2'");
  assert.equal(await code('somchai.j@example.co.th'), 'ok');

  // an invited account has no password, so the password form can never open it
  const pw = await db.query("SELECT 1 FROM ib_passwords p JOIN ib_users u ON u.id = p.user_id WHERE u.subject = 'somchai'");
  assert.equal(pw.length, 0);
});
