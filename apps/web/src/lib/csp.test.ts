import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentSecurityPolicy, gameServerSources } from './csp';

const directives = (policy: string) => new Map(policy.split('; ').map((d) => [d.split(' ')[0]!, d.split(' ').slice(1)]));

test('csp: scripts run only with the nonce, and eval only in development', () => {
  const prod = directives(contentSecurityPolicy({ nonce: 'abc', dev: false, connect: [] }));
  assert.deepEqual(prod.get('script-src'), ["'self'", "'nonce-abc'", "'strict-dynamic'"]);
  assert.ok(!prod.get('script-src')!.includes("'unsafe-inline'"));
  const dev = directives(contentSecurityPolicy({ nonce: 'abc', dev: true, connect: [] }));
  assert.ok(dev.get('script-src')!.includes("'unsafe-eval'"));
  assert.deepEqual(prod.get('object-src'), ["'none'"]);
  assert.deepEqual(prod.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(prod.get('connect-src'), ["'self'"]);
  assert.ok(prod.get('worker-src')!.includes('blob:'), 'canvas-confetti needs its blob: worker');
  assert.ok(prod.get('img-src')!.includes('https:'), 'question pictures come from any https host');
});

test('csp: the game connection is allowed where lib/socket.ts opens it', () => {
  assert.deepEqual(gameServerSources('192.168.1.20:3000', { basePath: '', port: '4000' }), ['http://192.168.1.20:4000', 'ws://192.168.1.20:4000']);
  assert.deepEqual(gameServerSources('localhost', { basePath: '', port: '4000' }), ['http://localhost:4000', 'ws://localhost:4000']);
  assert.deepEqual(gameServerSources('[::1]:3000', { basePath: '', port: '4000' }), ['http://[::1]:4000', 'ws://[::1]:4000']);
  for (const bad of ['', 'evil.com; script-src *', 'a b', "x'y", 'x:abc'])
    assert.deepEqual(gameServerSources(bad, { basePath: '', port: '4000' }), [], `a Host of ${JSON.stringify(bad)} adds nothing`);
  assert.deepEqual(gameServerSources('example.com', { basePath: '/icebreaker', port: '4000' }), [], "'self' covers it behind a proxy");
  assert.deepEqual(gameServerSources('x', { serverUrl: 'https://game.example.com/icebreaker', basePath: '', port: '4000' }), ['https://game.example.com', 'wss://game.example.com']);
  assert.deepEqual(gameServerSources('x', { serverUrl: 'http://10.0.0.5:4100', basePath: '/a', port: '4000' }), ['http://10.0.0.5:4100', 'ws://10.0.0.5:4100']);
  const policy = contentSecurityPolicy({ nonce: 'n', dev: false, connect: gameServerSources('localhost', { basePath: '', port: '4232' }) });
  assert.ok(policy.includes("connect-src 'self' http://localhost:4232 ws://localhost:4232;"));
});
