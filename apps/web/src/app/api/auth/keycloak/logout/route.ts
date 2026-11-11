import { logOut } from '@/server/auth';
import { basePath, ssoAvailable, ssoConfig } from '@/server/config';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { SsoError, appOrigin, clearHintCookie, discover, hintCookieName, oneCookie } from '@/server/keycloak';

/**
 * "Use another Microsoft account": ends our session and answers with Keycloak's logout address, so
 * the next company login asks who you are instead of signing the same account straight back in.
 * The plain log-out button only ends our session.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const cfg = ssoAvailable() ? ssoConfig() : null;
    if (!cfg) throw new HttpError(404, 'not_found');
    guardMutation(req);
    const headers = new Headers({ 'cache-control': 'no-store' });
    headers.append('set-cookie', await logOut(req));
    headers.append('set-cookie', clearHintCookie());
    let url: string | null = null;
    try {
      const end = (await discover(cfg)).end_session_endpoint;
      if (end) {
        const u = new URL(end);
        u.searchParams.set('client_id', cfg.clientId);
        u.searchParams.set('post_logout_redirect_uri', `${appOrigin(req, cfg)}${basePath()}/login`);
        // with the ID token Keycloak skips its "are you sure?" page
        const hint = oneCookie(req, hintCookieName());
        if (hint) u.searchParams.set('id_token_hint', hint);
        url = u.href;
      }
    } catch (e) {
      if (!(e instanceof SsoError)) throw e;
      console.error('[sso] logout:', e.message);
    }
    return Response.json({ url }, { headers });
  });
}
