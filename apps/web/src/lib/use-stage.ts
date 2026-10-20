'use client';

import { useEffect, useState } from 'react';
import type { StageState } from '@icebreaker/shared';
import { keepClockSynced, syncClock } from './clock';
import { BASE_PATH } from './paths';
import { gameServer, getSocket } from './socket';
import { keys, load } from './storage';

export type StageStatus = 'connecting' | 'ready' | 'not_found' | 'not_allowed' | 'closed';

/**
 * Live state for the big screen. The Host page attaches with the token saved
 * when the room was created; a Stage-only screen (projector) just watches.
 */
export function useStage(pin: string, role: 'host' | 'stage') {
  const [state, setState] = useState<StageState | null>(null);
  const [status, setStatus] = useState<StageStatus>('connecting');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const socket = getSocket();
    let alive = true;

    const attach = async () => {
      setOnline(true);
      void syncClock(socket);
      try {
        const res =
          role === 'host'
            ? await socket.timeout(8000).emitWithAck('host:attach', { pin, hostToken: load(keys.hostToken(pin), '') })
            : await socket.timeout(8000).emitWithAck('stage:attach', pin);
        if (!alive) return;
        if (res.ok) setStatus('ready');
        else setStatus(res.error === 'room_not_found' ? 'not_found' : 'not_allowed');
      } catch {
        // no answer yet: the next reconnect tries again
      }
    };
    const onState = (s: StageState) => {
      if (s.pin === pin) setState(s);
    };
    const onClosed = () => setStatus('closed');
    const onDown = () => setOnline(false);

    socket.on('stage:state', onState);
    socket.on('room:closed', onClosed);
    socket.on('connect', attach);
    socket.on('disconnect', onDown);
    if (socket.connected) void attach();
    const stopSync = keepClockSynced(socket);
    return () => {
      alive = false;
      stopSync();
      socket.off('stage:state', onState);
      socket.off('room:closed', onClosed);
      socket.off('connect', attach);
      socket.off('disconnect', onDown);
      // moving to another page keeps the tab's connection, which would otherwise keep watching the room
      socket.emit('stage:leave');
    };
  }, [pin, role]);

  return { state, status, online };
}

/**
 * The address players type or scan. When the Host opened the app on
 * localhost, phones can't use that, so ask the game server for its LAN IP.
 * Behind a reverse proxy the page's own address is already the public one.
 */
export function useJoinUrl(pin: string) {
  const [base, setBase] = useState<string | null>(null);

  useEffect(() => {
    const configured = process.env.NEXT_PUBLIC_JOIN_BASE_URL;
    if (configured) return setBase(configured.replace(/\/$/, ''));
    const { protocol, hostname, port, origin } = location;
    setBase(origin + BASE_PATH);
    if (BASE_PATH || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return;
    let alive = true;
    const server = gameServer();
    fetch(`${server.origin}${server.mount}/info`)
      .then((r) => r.json() as Promise<{ lanAddresses?: string[] }>)
      .then((info) => {
        const ip = info.lanAddresses?.[0];
        if (alive && ip) setBase(`${protocol}//${ip}${port ? `:${port}` : ''}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!base) return null;
  return { url: `${base}/play?pin=${pin}`, label: `${base.replace(/^https?:\/\//, '')}/play` };
}
