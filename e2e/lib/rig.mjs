// What every browser check needs: the packages it borrows, and the browser it drives.
//
// The checks are deliberately not a workspace, so that the npm ci and npm test that deploy.sh runs on the
// production box never pull a browser library onto it. playwright-core is theirs alone (declared in the
// package.json here, installed by its own npm install); socket.io-client is borrowed from the game server, so
// that the client they join a room with is always the version the server was built against.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));

// The office machines drive the Microsoft Edge they already have. E2E_BROWSER points at any other Chromium
// build; with none of these present, Playwright falls back to a browser it downloaded itself.
const USUAL = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
];
const chosen = process.env.E2E_BROWSER || USUAL.find((p) => existsSync(p));
if (process.env.E2E_BROWSER && !existsSync(process.env.E2E_BROWSER))
  throw new Error(`E2E_BROWSER points at nothing: ${process.env.E2E_BROWSER}`);
export const launchOptions = chosen ? { executablePath: chosen } : {};
