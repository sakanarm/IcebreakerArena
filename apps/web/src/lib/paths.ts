/**
 * The subpath the app is served under behind a reverse proxy (e.g. `/icebreaker`), or '' at the
 * root. next.config.ts normalizes NEXT_PUBLIC_BASE_PATH and inlines it at build time.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Next.js prefixes <Link> and router URLs itself; plain <a href>, history and location.href need this. */
export const withBase = (path: string) => `${BASE_PATH}${path}`;
