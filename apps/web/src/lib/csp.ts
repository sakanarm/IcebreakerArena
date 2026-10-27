/**
 * The Content Security Policy every page is served with (proxy.ts sets it, with a fresh nonce per request).
 * Next.js puts the nonce on its own scripts; 'strict-dynamic' lets the chunks they load run, and nothing else:
 * a script tag that got into the page some other way has no nonce, so it never runs.
 */
export function contentSecurityPolicy({ nonce, dev, connect }: { nonce: string; dev: boolean; connect: string[] }): string {
  return [
    "default-src 'self'",
    // React's development build reads server error stacks with eval; the production build never does
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // motion and the server-rendered HTML put style attributes on elements, which a nonce can not cover
    "style-src 'self' 'unsafe-inline'",
    // question pictures link to any https host (validate.ts allows nothing else); the QR code is inline SVG
    "img-src 'self' data: blob: https:",
    // the fonts ship with the app (@fontsource)
    "font-src 'self'",
    ["connect-src 'self'", ...connect].join(' '),
    // canvas-confetti draws in a worker it makes from a blob: URL
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Where the browser opens its game connection (lib/socket.ts), as connect-src sources. Behind a reverse proxy
 * that is the page's own origin, which 'self' already covers. A source with http also lets https through, and
 * ws also wss, so a page served over TLS on the same host needs no other entry.
 */
export function gameServerSources(
  pageHost: string,
  env: { serverUrl?: string; basePath: string; port: string },
): string[] {
  if (env.serverUrl) {
    const url = new URL(env.serverUrl);
    return [url.origin, `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`];
  }
  if (env.basePath) return [];
  // the Host header the browser sent (the server itself listens on 0.0.0.0); anything that is not a plain
  // hostname or [IPv6] gets no entry, so a made-up Host can not write directives into the policy
  const hostname = pageHost.match(/^([a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d+)?$/i)?.[1];
  if (!hostname) return [];
  const host = `${hostname}:${env.port}`;
  return [`http://${host}`, `ws://${host}`];
}
