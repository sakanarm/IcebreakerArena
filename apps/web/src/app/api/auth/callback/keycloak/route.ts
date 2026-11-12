import { audit } from '@/server/audit';
import { startSession } from '@/server/auth';
import { ssoAvailable, ssoConfig } from '@/server/config';
import { getDb } from '@/server/db';
import { HttpError, handle } from '@/server/http';
import {
  SSO_ISSUER,
  SsoError,
  backToLogin,
  clearFlowCookie,
  discover,
  emailFrom,
  exchangeCode,
  findSsoUser,
  flowCookieName,
  hintCookie,
  keycloakKey,
  oneCookie,
  openFlow,
  redirectTo,
  redirectUri,
  verifyIdToken,
} from '@/server/keycloak';

/** Why a company login was turned away, without the email: the person may not even work with us. */
async function refused(reason: string) {
  try {
    await audit(await getDb(), null, 'login_refused', null, { issuer: SSO_ISSUER, reason });
  } catch (e) {
    console.error('[sso] audit:', e);
  }
}

/**
 * Company login, step 2: Keycloak sends the person back here with a one-time code. We check it is
 * the login this browser started, trade the code for an ID token, check the token, and let in the
 * account that has the email in it, making an ordinary one on a first login. Everything else goes back
 * to the login page with a reason.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const cfg = ssoAvailable() ? ssoConfig() : null;
    if (!cfg) throw new HttpError(404, 'not_found');
    const params = new URL(req.url).searchParams;
    // the flow cookie is used once, whatever happens next
    const clear = clearFlowCookie();
    const flow = openFlow(cfg, oneCookie(req, flowCookieName()));
    const state = params.get('state');
    // no cookie, an old one, a forged one, or a state from another login: start again
    if (!flow || !state || state !== flow.state) return backToLogin('sso_expired', flow?.next ?? '/host', [clear]);
    const next = flow.next;

    const error = params.get('error');
    if (error) {
      if (error === 'access_denied') return backToLogin('sso_cancelled', next, [clear]);
      console.error('[sso] Keycloak said:', /^[\w.-]{1,64}$/.test(error) ? error : 'an error');
      return backToLogin('sso_failed', next, [clear]);
    }
    const code = params.get('code');
    if (!code || code.length > 4096) return backToLogin('sso_failed', next, [clear]);

    let idToken: string;
    let email: string | null;
    let name: string | null;
    try {
      const d = await discover(cfg);
      idToken = await exchangeCode(cfg, d, code, redirectUri(req, cfg), flow.verifier);
      const claims = await verifyIdToken(idToken, {
        issuer: cfg.issuer,
        clientId: cfg.clientId,
        nonce: flow.nonce,
        keyFor: (kid, alg) => keycloakKey(d, kid, alg),
      });
      email = emailFrom(claims);
      name = typeof claims.name === 'string' ? claims.name : null;
    } catch (e) {
      if (!(e instanceof SsoError)) throw e;
      console.error('[sso] callback:', e.message);
      return backToLogin('sso_failed', next, [clear]);
    }
    if (!email) {
      await refused('no_email');
      return backToLogin('no_account', next, [clear]);
    }

    try {
      const { setCookie } = await startSession(req, SSO_ISSUER, (sql) => findSsoUser(sql, email, { name }));
      return redirectTo(next, [setCookie, clear, hintCookie(idToken)]);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 403) throw e;
      await refused(e.code);
      return backToLogin(e.code, next, [clear]);
    }
  });
}
