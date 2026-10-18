// pm2 process file for production: `npm run build`, then `pm2 start ecosystem.config.js`.
//
// The defaults serve phones directly: web on :3000 and the game server on :4000, on every interface.
// Behind a reverse proxy, give `npm run build` and `pm2 start` the same values (deploy/deploy.sh does):
//   NEXT_PUBLIC_BASE_PATH=/icebreaker BIND_HOST=127.0.0.1 WEB_PORT=4231 GAME_PORT=4232
const path = require('node:path');

const web = path.join(__dirname, 'apps/web');
const host = process.env.BIND_HOST || '0.0.0.0';
const webPort = Number(process.env.WEB_PORT || 3000);
const gamePort = Number(process.env.GAME_PORT || 4000);

module.exports = {
  apps: [
    {
      name: 'icebreaker-server',
      cwd: path.join(__dirname, 'apps/server'),
      // node itself, so pm2 runs exactly `node --import tsx src/index.ts` instead of guessing how to load TypeScript
      script: process.execPath,
      interpreter: 'none',
      args: '--import tsx src/index.ts',
      // rooms live in this process's memory: never run more than one, and a restart ends every live game
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', HOST: host, PORT: gamePort },
      time: true,
    },
    {
      name: 'icebreaker-web',
      cwd: web,
      // next's own entry rather than `npm start`, which pm2 cannot launch on Windows
      script: require.resolve('next/dist/bin/next', { paths: [web] }),
      args: `start -H ${host} -p ${webPort}`,
      instances: 1,
      exec_mode: 'fork',
      // next.config.ts reads the base path again at start-up, so it must match the build
      env: { NODE_ENV: 'production', NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH || '' },
      time: true,
    },
  ],
};
