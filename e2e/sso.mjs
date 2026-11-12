// Company login (Keycloak, which hands over to Microsoft) in a real browser.
//
// With --fake-kc, the whole road against a stand-in for Keycloak that this script runs itself: the button sends
// the person to Keycloak with this client, PKCE (S256), a state, a nonce and kc_idp_hint; the code is traded with
// the client secret (Basic) and the PKCE verifier, once only; an email in any case lands in the account that has
// it, on the page the login started from; preferred_username stands in when there is no email; someone with no
// account gets an ordinary one made on the first login and the same one after; an email that clashes with another
// account's, a disabled account, a cancel, a bad signature, a wrong nonce, a replayed callback, a forged state and a planted
// second cookie all come back to the login page with a reason and no session; "use another Microsoft account"
// logs out at Keycloak with the ID token; the client secret never reaches the browser; no console errors; and
// phones never scroll sideways.
//
// --fake-kc needs a web server whose Keycloak is that stand-in, and invited accounts (see e2e/README.md):
//   IB_DATA_DIR=<empty folder> KEYCLOAK_ISSUER=http://127.0.0.1:<port>/realms/mfec KEYCLOAK_CLIENT_ID=pika-arena
//   KEYCLOAK_CLIENT_SECRET=e2e-only-client-secret-0000 AUTH_MODE=local (or oidc, with --oidc)
//   node sso.mjs --base=http://localhost:3000 --fake-kc=<port> [--oidc] [--shots=<dir>]
// Against a server where company login is not set up (production until its client is made), read only:
//   node sso.mjs --base=https://dmhub.mfec.dev/PikaArena --expect-off
import { chromium } from 'playwright-core';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { launchOptions } from './lib/rig.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const flag = (name) => process.argv.includes(`--${name}`);
const WEB = (arg('base') || 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = arg('shots');
const FAKE_PORT = Number(arg('fake-kc') || 0);
const OIDC = flag('oidc');
const EXPECT_OFF = flag('expect-off');
const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(WEB);
if (FAKE_PORT && !local) throw new Error('--fake-kc is for a dev server on this machine');
if (!FAKE_PORT && !EXPECT_OFF) throw new Error('say --fake-kc=<port> (a dev server) or --expect-off (a server without company login)');

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (ok) passed++;
  else failed++;
  return ok;
};
const shoot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ---------- the stand-in for Keycloak ----------

const CLIENT = 'pika-arena';
const SECRET = 'e2e-only-client-secret-0000';
const REALM = '/realms/mfec';
const ISSUER = `http://127.0.0.1:${FAKE_PORT}${REALM}`;
const OIDC_PATH = `${REALM}/protocol/openid-connect`;
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'e2e-sig';

const kc = {
  authorize: [], // the query of every authorize request
  tokens: [], // { ok, why } per token request
  logouts: [], // the query of every logout request
  codes: new Map(), // code -> { email, nonce, challenge, redirect, used }
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken({ email, nonce }, { key = signing.privateKey, nonceOverride } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: ISSUER, aud: CLIENT, azp: CLIENT, sub: `sub-${email}`, exp: now + 300, iat: now, nonce: nonceOverride ?? nonce, name: 'คนใหม่ ทดสอบ' };
  // "pu:" in front: no email claim, only preferred_username, as some Microsoft accounts come through
  if (email.startsWith('pu:')) claims.preferred_username = email.slice(3);
  else claims.email = email;
  const input = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64(claims)}`;
  return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => resolve(data));
});

const fake = createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const redirect = (to) => {
    res.writeHead(302, { location: to });
    res.end();
  };
  if (url.pathname === `${REALM}/.well-known/openid-configuration`) {
    return send(200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
      token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
      end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
    });
  }
  if (url.pathname === `${OIDC_PATH}/certs`) {
    return send(200, {
      keys: [
        { ...stranger.publicKey.export({ format: 'jwk' }), kid: KID, use: 'enc', alg: 'RSA-OAEP' },
        { ...signing.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' },
      ],
    });
  }
  if (url.pathname === `${OIDC_PATH}/auth` && req.method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    kc.authorize.push(q);
    if (q.client_id !== CLIENT) return send(400, 'Invalid client', 'text/plain');
    const hidden = ['state', 'nonce', 'code_challenge', 'redirect_uri'].map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] ?? '')}">`).join('');
    return send(
      200,
      `<!doctype html><title>Fake Keycloak</title><h1>Fake Keycloak</h1><form method="post" action="${OIDC_PATH}/auth/done">${hidden}` +
        `<input id="kc-email" name="email" autofocus><button id="kc-ok" name="act" value="ok">Sign in</button>` +
        `<button id="kc-cancel" name="act" value="cancel">Cancel</button></form>`,
      'text/html; charset=utf-8',
    );
  }
  if (url.pathname === `${OIDC_PATH}/auth/done` && req.method === 'POST') {
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const back = new URL(f.redirect_uri);
    back.searchParams.set('state', f.state);
    if (f.act === 'cancel') {
      back.searchParams.set('error', 'access_denied');
      return redirect(back.href);
    }
    const code = randomBytes(16).toString('hex');
    kc.codes.set(code, { email: f.email, nonce: f.nonce, challenge: f.code_challenge, redirect: f.redirect_uri, used: false });
    back.searchParams.set('code', code);
    back.searchParams.set('session_state', 'e2e');
    return redirect(back.href);
  }
  if (url.pathname === `${OIDC_PATH}/token` && req.method === 'POST') {
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const refuse = (why) => {
      kc.tokens.push({ ok: false, why });
      send(400, { error: 'invalid_grant', error_description: why });
    };
    const [id, secret] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':').map(decodeURIComponent);
    if (id !== CLIENT || secret !== SECRET) return refuse('client auth');
    if (f.grant_type !== 'authorization_code') return refuse('grant_type');
    const c = kc.codes.get(f.code);
    if (!c) return refuse('unknown code');
    if (c.used) return refuse('code used twice');
    c.used = true;
    if (f.redirect_uri !== c.redirect) return refuse('redirect_uri');
    if (createHash('sha256').update(f.code_verifier ?? '').digest('base64url') !== c.challenge) return refuse('pkce');
    kc.tokens.push({ ok: true });
    const opts = c.email.startsWith('badsig') ? { key: stranger.privateKey } : c.email.startsWith('badnonce') ? { nonceOverride: 'not-this-login' } : {};
    return send(200, { access_token: 'e2e', token_type: 'Bearer', expires_in: 300, id_token: idToken(c, opts) });
  }
  if (url.pathname === `${OIDC_PATH}/logout`) {
    const q = Object.fromEntries(url.searchParams);
    kc.logouts.push(q);
    return q.post_logout_redirect_uri ? redirect(q.post_logout_redirect_uri) : send(200, 'logged out', 'text/plain');
  }
  send(404, { error: 'not found' });
});

// ---------- the checks ----------

const browser = await chromium.launch(launchOptions);
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const bodies = [];
  const complaints = [];
  p.on('pageerror', (e) => complaints.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) complaints.push(`console: ${m.text().slice(0, 300)}`);
  });
  p.on('response', async (r) => {
    if (!r.url().startsWith(WEB)) return;
    try {
      bodies.push(await r.text());
    } catch {}
  });
  const api = (path, init = {}) =>
    p.evaluate(
      async ({ url, init }) => {
        const r = await fetch(url, { ...init, headers: { 'x-ib-req': '1', ...(init.headers ?? {}) } });
        return { status: r.status, body: await r.text() };
      },
      { url: `${WEB}/api${path}`, init },
    );
  const me = async () => JSON.parse((await api('/auth/me')).body);

  if (EXPECT_OFF) {
    await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    const m = await me();
    check(m.sso === false, `company login is not offered (mode ${m.mode})`);
    check((await p.getByText('เข้าสู่ระบบด้วยบัญชีบริษัท').count()) === 0, 'the login page has no company button');
    for (const path of ['/auth/keycloak?next=/host', '/auth/callback/keycloak?code=x&state=y']) check((await api(path)).status === 404, `GET /api${path.split('?')[0]} is 404`);
    check((await api('/auth/keycloak/logout', { method: 'POST' })).status === 404, 'POST /api/auth/keycloak/logout is 404');
    check(complaints.length === 0, `no console errors${complaints.length ? `: ${complaints.join(' | ')}` : ''}`);
  } else {
    await new Promise((resolve) => fake.listen(FAKE_PORT, '127.0.0.1', resolve));
    const login = async (email, { next = '/host', act = 'ok' } = {}) => {
      await p.goto(`${WEB}/login?next=${encodeURIComponent(next)}`, { waitUntil: 'networkidle' });
      await p.getByRole('link', { name: 'เข้าสู่ระบบด้วยบัญชีบริษัท' }).click();
      await p.waitForURL(`${ISSUER}/**`, { timeout: 20000 });
      if (act === 'stay') return;
      if (act === 'cancel') await p.locator('#kc-cancel').click();
      else {
        await p.locator('#kc-email').fill(email);
        await p.locator('#kc-ok').click();
      }
      await p.waitForURL((u) => u.href.startsWith(WEB) && !u.pathname.includes('/api/'), { timeout: 20000 });
      await p.waitForLoadState('networkidle');
    };
    const loginError = () => new URL(p.url()).searchParams.get('error');
    const logout = () => api('/auth/logout', { method: 'POST' });

    // the page
    await p.goto(`${WEB}/login?next=/exam`, { waitUntil: 'networkidle' });
    const m = await me();
    check(m.sso === true && m.mode === (OIDC ? 'oidc' : 'local'), `company login is offered (mode ${m.mode})`);
    check(await p.getByRole('link', { name: 'เข้าสู่ระบบด้วยบัญชีบริษัท' }).isVisible(), 'the login page shows the company button');
    check((await p.locator('#login-password').count()) === 0, 'only the company button: no password form');
    await p.goto(`${WEB}/login?with=password&next=/exam`, { waitUntil: 'networkidle' });
    check((await p.locator('#login-password').count()) === (OIDC ? 0 : 1), OIDC ? 'oidc: no password form even with ?with=password' : 'local: ?with=password still opens the password form');
    await p.goto(`${WEB}/login?next=/exam`, { waitUntil: 'networkidle' });
    if (OIDC) {
      const r = await api('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'x', password: 'y' }) });
      check(r.status === 404, 'oidc: the password login API is gone (404)');
    }
    await shoot(p, OIDC ? 'login-oidc' : 'login-local');

    // the trip to Keycloak
    await login('Somchai.J@Example.CO.TH', { next: '/exam?x=1' });
    const a = kc.authorize.at(-1);
    check(a.client_id === CLIENT && a.response_type === 'code' && a.scope === 'openid email profile', 'authorize: this client, a code, openid email profile');
    check(a.redirect_uri === `${WEB}/api/auth/callback/keycloak`, `authorize: redirect_uri ${a.redirect_uri}`);
    check(a.code_challenge_method === 'S256' && /^[\w-]{43}$/.test(a.code_challenge ?? ''), 'authorize: PKCE S256');
    check(/^[\w-]{43}$/.test(a.state ?? '') && /^[\w-]{43}$/.test(a.nonce ?? '') && a.state !== a.nonce, 'authorize: a fresh state and nonce');
    check(a.kc_idp_hint === 'entra', 'authorize: kc_idp_hint=entra');
    check(kc.tokens.at(-1)?.ok === true, 'token: Basic client secret, the same redirect_uri, the PKCE verifier');
    const u = new URL(p.url());
    check(u.pathname === `${new URL(WEB).pathname.replace(/\/$/, '')}/exam` && u.search === '?x=1', `an email in other case lands on next (${u.pathname}${u.search})`);
    const who = await me();
    check(who.user?.name === 'สมชาย', `logged in as the invited account (${who.user?.name})`);
    const cookies = await ctx.cookies(WEB);
    check(cookies.some((c) => c.name === 'ib_sid') && !cookies.some((c) => c.name === 'ib_sso'), 'a session cookie, and the login cookie is gone');

    // the same callback again: the code is spent and the login cookie is gone
    const lastCode = [...kc.codes.keys()].at(-1);
    await p.goto(`${WEB}/api/auth/callback/keycloak?code=${lastCode}&state=${a.state}`, { waitUntil: 'networkidle' });
    check(loginError() === 'sso_expired', `a replayed callback is refused (${loginError()})`);
    check((await me()).user?.name === 'สมชาย', 'and the session it had is untouched');

    // "use another Microsoft account" logs out at Keycloak with the ID token
    const out = await api('/auth/keycloak/logout', { method: 'POST' });
    const end = new URL(JSON.parse(out.body).url);
    check(
      end.href.startsWith(`${ISSUER}/protocol/openid-connect/logout`) &&
        end.searchParams.get('client_id') === CLIENT &&
        end.searchParams.get('post_logout_redirect_uri') === `${WEB}/login` &&
        (end.searchParams.get('id_token_hint') ?? '').split('.').length === 3,
      'switch account: Keycloak logout with client_id, id_token_hint and a way back to /login',
    );
    check((await me()).user === null, 'switch account: our session ended');
    check((await api('/auth/keycloak/logout', { method: 'POST', headers: { 'x-ib-req': '' } })).status === 403, 'switch account needs our own page (403 without the header)');

    // someone the app has never seen: an ordinary account is made on the first login, and found on the next
    const newcomer = `new.${Date.now().toString(36)}@example.co.th`;
    await login(newcomer, { next: '/host' });
    const made = (await me()).user;
    check(loginError() === null && made?.name === 'คนใหม่ ทดสอบ' && made?.role === 'maker', `a first login makes an ordinary account (${made?.name ?? loginError()}, ${made?.role})`);
    check(new URL(p.url()).pathname.endsWith('/host'), 'and lands on the page it started from');
    await logout();
    await login(newcomer.toUpperCase(), { next: '/host' });
    check((await me()).user?.id === made?.id, 'the next login finds the same account');
    await logout();

    // turned away, each with its reason and no session
    await login('somchai_j@other.example.com');
    check(loginError() === 'no_account', `an email that clashes with another account's: no_account (${loginError()})`);
    check(await p.getByText('บัญชีบริษัทนี้ยังเข้าใช้ไม่ได้').isVisible(), 'and is told to ask the admin');
    check((await p.getByRole('link', { name: 'ไปหน้าเข้าร่วมเกม' }).count()) === 1, 'and players are pointed to the join page');
    check((await me()).user === null, 'a clash gets no session');
    await shoot(p, 'no-account');
    await p.getByRole('button', { name: 'ใช้บัญชี Microsoft อื่น' }).click();
    await p.waitForURL(`${WEB}/login`, { timeout: 20000 });
    check(kc.logouts.at(-1)?.post_logout_redirect_uri === `${WEB}/login`, 'the "another account" button goes through Keycloak logout and back');

    await login('off.user@example.co.th');
    check(loginError() === 'account_disabled' && (await me()).user === null, `a disabled account: account_disabled (${loginError()})`);
    await login('', { act: 'cancel' });
    check(loginError() === 'sso_cancelled' && (await p.getByText('ยกเลิกการเข้าสู่ระบบแล้ว').isVisible()), `cancel at Microsoft: sso_cancelled (${loginError()})`);
    await login('badsig@example.co.th');
    check(loginError() === 'sso_failed' && (await me()).user === null, `a token signed by someone else: sso_failed (${loginError()})`);
    await login('badnonce@example.co.th');
    check(loginError() === 'sso_failed' && (await me()).user === null, `a token for another login: sso_failed (${loginError()})`);

    // a forged state
    await login('', { act: 'stay' });
    await p.goto(`${WEB}/api/auth/callback/keycloak?code=abc&state=forged`, { waitUntil: 'networkidle' });
    check(loginError() === 'sso_expired' && (await me()).user === null, `a forged state: sso_expired (${loginError()})`);

    // another app on the host plants a second login cookie: neither is trusted
    await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await p.getByRole('link', { name: 'เข้าสู่ระบบด้วยบัญชีบริษัท' }).click();
    await p.waitForURL(`${ISSUER}/**`, { timeout: 20000 });
    await ctx.addCookies([{ name: 'ib_sso', value: 'planted', domain: new URL(WEB).hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await p.locator('#kc-email').fill('somchai.j@example.co.th');
    await p.locator('#kc-ok').click();
    await p.waitForURL((x) => x.href.startsWith(WEB) && !x.pathname.includes('/api/'), { timeout: 20000 });
    check(loginError() === 'sso_expired' && (await me()).user === null, `a planted second login cookie: refused (${loginError()})`);
    await ctx.clearCookies({ name: 'ib_sso' });

    // preferred_username when there is no email claim
    await login('pu:Nok.P@example.co.th');
    check((await me()).user?.name === 'นก', `no email claim: preferred_username finds the account (${(await me()).user?.name ?? loginError()})`);
    await logout();

    // a phone
    await p.setViewportSize({ width: 360, height: 740 });
    await p.goto(`${WEB}/login?error=no_account`, { waitUntil: 'networkidle' });
    check(await noSideScroll(p), 'a phone: the login page never scrolls sideways');
    await shoot(p, 'phone-no-account');

    check(!bodies.some((b) => b.includes(SECRET)), 'the client secret never reaches the browser');
    check(complaints.length === 0, `no console errors${complaints.length ? `: ${complaints.join(' | ')}` : ''}`);
  }
} finally {
  await browser.close();
  fake.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
