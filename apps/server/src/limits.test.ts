import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MissLimiter, clientAddress } from './limits';

const T0 = 1_000_000;

test('an address gets its burst of misses, then about one a second; another address is not held back', () => {
  const misses = new MissLimiter(60, 1);
  let through = 0;
  // someone guessing as fast as they can for half a minute
  for (let t = T0; t <= T0 + 30_000; t += 7) {
    if (!misses.allows('203.0.113.7', t)) continue;
    misses.miss('203.0.113.7', t);
    through++;
  }
  assert.ok(through >= 89 && through <= 91, `${through} misses got through in 30 s, not the burst and about 30 more`);
  assert.equal(misses.allows('203.0.113.7', T0 + 30_000), false);
  assert.equal(misses.allows('203.0.113.8', T0 + 30_000), true);
  // left alone, the count drains away
  assert.equal(misses.allows('203.0.113.7', T0 + 31_000), true);
});

test('a sweep forgets only the addresses whose misses have drained', () => {
  const misses = new MissLimiter(60, 1);
  misses.miss('203.0.113.7', T0);
  misses.miss('203.0.113.7', T0);
  misses.miss('203.0.113.8', T0);
  misses.sweep(T0 + 1500);
  assert.equal(misses.size, 1);
  misses.sweep(T0 + 2000);
  assert.equal(misses.size, 0);
});

test('behind the proxy a connection counts against the client the proxy names; straight in, against its own address', () => {
  // the proxy connects from loopback and names the client
  assert.equal(clientAddress('127.0.0.1', { 'x-real-ip': '203.0.113.7' }), '203.0.113.7');
  assert.equal(clientAddress('::ffff:127.0.0.1', { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }), '203.0.113.7');
  assert.equal(clientAddress('127.0.0.1', { 'x-real-ip': ['203.0.113.7', '198.51.100.1'] }), '203.0.113.7');
  // without X-Real-IP: the last X-Forwarded-For entry, the one the proxy added after whatever the client sent
  assert.equal(clientAddress('::1', { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }), '203.0.113.9');
  // junk names no one, so the connection is its own address
  assert.equal(clientAddress('127.0.0.1', { 'x-real-ip': 'not an address' }), '127.0.0.1');
  assert.equal(clientAddress('127.0.0.1', { 'x-forwarded-for': 'junk' }), '127.0.0.1');
  assert.equal(clientAddress('127.0.0.1', {}), '127.0.0.1');
  // a phone on the Wi-Fi of a laptop running the game: whatever it says about itself, it is where it connects from
  const spoofed = { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7' };
  assert.equal(clientAddress('::ffff:192.168.1.20', spoofed), '192.168.1.20');
  assert.equal(clientAddress('192.168.1.20', spoofed), '192.168.1.20');
});

test('IPv6 addresses count per /64, however they are written', () => {
  assert.equal(clientAddress('2001:db8:aa:bb:1:2:3:4', {}), '2001:db8:aa:bb::/64');
  assert.equal(clientAddress('2001:db8:aa:bb::9', {}), '2001:db8:aa:bb::/64');
  assert.equal(clientAddress('2001:0DB8:00AA:00BB:ffff::1', {}), '2001:db8:aa:bb::/64');
  assert.equal(clientAddress('127.0.0.1', { 'x-real-ip': '2001:db8:aa:bb:0:0:0:1' }), '2001:db8:aa:bb::/64');
  assert.notEqual(clientAddress('2001:db8:aa:bc::9', {}), '2001:db8:aa:bb::/64');
  assert.equal(clientAddress('2001:db8::1', {}), '2001:db8:0:0::/64');
  assert.equal(clientAddress('2001:db8::203.0.113.7', {}), '2001:db8:0:0::/64');
  assert.equal(clientAddress('::1', { 'x-real-ip': 'fe80::1%eth0' }), 'fe80:0:0:0::/64');
});
