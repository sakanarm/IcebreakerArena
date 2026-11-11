import { ssoAvailable, ssoConfig } from '@/server/config';
import { HttpError, handle } from '@/server/http';
import { SsoError, authorizeUrl, backToLogin, discover, flowCookie, newFlow, safeNext } from '@/server/keycloak';

/**
 * Company login, step 1: the "log in with your company account" button links here. We remember the
 * login in a short signed cookie and send the person to Keycloak, which hands over to Microsoft.
 * Only exists when accounts are on and Keycloak is set up.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const cfg = ssoAvailable() ? ssoConfig() : null;
    if (!cfg) throw new HttpError(404, 'not_found');
    const next = safeNext(new URL(req.url).searchParams.get('next'));
    let target: string;
    const flow = newFlow(next);
    try {
      target = authorizeUrl(req, cfg, await discover(cfg), flow);
    } catch (e) {
      if (!(e instanceof SsoError)) throw e;
      console.error('[sso] start:', e.message);
      return backToLogin('sso_failed', next);
    }
    return new Response(null, {
      status: 303,
      headers: { location: target, 'set-cookie': flowCookie(cfg, flow), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  });
}
