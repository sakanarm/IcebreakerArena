import { GAME_SERVER_PORT } from '@icebreaker/shared';
import { lanAddresses, startGameServer } from './server';

const port = Number(process.env.PORT ?? GAME_SERVER_PORT);
// 0.0.0.0 so phones on the same Wi-Fi can join
const host = process.env.HOST ?? '0.0.0.0';

const server = await startGameServer(port, host);
console.log(`Game server ready on http://${host === '0.0.0.0' ? 'localhost' : host}:${server.port}`);
// behind a reverse proxy it listens on loopback only, so LAN addresses would be misleading
if (host === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  LAN: http://${ip}:${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
