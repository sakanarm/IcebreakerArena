import { networkInterfaces } from 'node:os';
import path from 'node:path';
import type { NextConfig } from 'next';

// Phones on the same Wi-Fi open the dev server by LAN IP; Next.js only serves dev assets to known origins.
const lanHosts = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);

const monorepoRoot = path.resolve(process.cwd(), '../..');

// Behind a reverse proxy the app lives under a subpath such as `/icebreaker`. `next build` and
// `next start` both read this file, so they must see the same value. '/x/' and 'x' become '/x'.
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const basePath = rawBasePath.trim().replace(/\/+$/, '').replace(/^(?=[^/])/, '/');
// Git Bash on Windows turns `/icebreaker` into `C:/Program Files/Git/icebreaker` unless MSYS_NO_PATHCONV=1
if (basePath && !/^(\/[\w.~-]+)+$/.test(basePath)) {
  throw new Error(`NEXT_PUBLIC_BASE_PATH should look like /icebreaker, got "${rawBasePath}"`);
}

// Without a base path the browser dials the game server's own port (lib/socket.ts), so the build
// needs the GAME_PORT that pm2 gives the game server. Unset means 4000.
const gamePort = process.env.GAME_PORT?.trim() ?? '';
if (gamePort && !(/^[1-9]\d{0,4}$/.test(gamePort) && Number(gamePort) <= 65535)) {
  throw new Error(`GAME_PORT should be a port number, got "${process.env.GAME_PORT}"`);
}

const nextConfig: NextConfig = {
  basePath,
  // the normalized values are what the browser code sees (lib/paths.ts, lib/socket.ts)
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_GAME_PORT: gamePort },
  transpilePackages: ['@icebreaker/shared'],
  // the dev/test database loads its WASM from its own folder at run time; `pg` is external by default
  serverExternalPackages: ['@electric-sql/pglite'],
  allowedDevOrigins: lanHosts,
  poweredByHeader: false,
  // the dev badge sits on top of the phone's answer buttons and the host dock
  devIndicators: false,
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  // the Content Security Policy needs a nonce per page, so proxy.ts sets that one
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // the PIN is in the join link: other sites get no referrer at all
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
