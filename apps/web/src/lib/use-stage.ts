'use client';

import { useEffect, useState } from 'react';
import type { StageState } from '@icebreaker/shared';
import { keepClockSynced, syncClock } from './clock';
import { BASE_PATH } from './paths';
import { gameServer, getSocket } from './socket';
import { keys, load } from './storage';

export type StageStatus = 'connecting' | 'ready' | 'not_found' | 'not_allowed' | 'closed';

/** how long to wait before asking again, after no answer or being told to slow down */
const RETRY_MS = 5000;

/**
 * The big screen's token, after the # in the link the Host's page makes: a fragment never reaches a server, a log
 * or a Referer. Whatever a chat app tacked on after it (a full stop, a bracket) is no part of it.
 */
const tokenInLink = () => location.hash.slice(1).replace(/[^\w-].*$/, '');

/**
 * Live state for the big screen. The Host page attaches with the token saved when the room was created, and is
 * given the one a big screen needs (`stageToken`) to make its link; a big screen on its own (a projector) attaches
 * with that token from the link.
 */
export function useStage(pin: string, role: 'host' | 'stage') {
  const [state, setState] = useState<StageState | null>(null);
  const [status, setStatus] = useState<StageStatus>('connecting');
  const [online, setOnline] = useState(true);
  const [stageToken, setStageToken] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const attach = async () => {
      clearTimeout(retry);
      setOnline(true);
      void syncClock(socket);
      try {
        const res =
          role === 'host'
            ? await socket.timeout(8000).emitWithAck('host:attach', { pin, hostToken: load(keys.hostToken(pin), '') })
            : await socket.timeout(8000).emitWithAck('stage:attach', { pin, stageToken: tokenInLink() });
        if (!alive) return;
        if (res.ok) {
          setStatus('ready');
          if ('stageToken' in res) setStageToken(res.stageToken);
          return;
        }
        if (res.error !== 'rate_limited') return setStatus(res.error === 'room_not_found' ? 'not_found' : 'not_allowed');
      } catch {
        // no answer
      }
      // ask again in a while, for as long as the connection holds; a reconnect asks anyway
      if (alive && socket.connected) retry = setTimeout(() => void attach(), RETRY_MS);
    };
    const onState = (s: StageState) => {
      if (s.pin === pin) setState(s);
    };
    const onClosed = () => setStatus('closed');
    const onDown = () => {
      clearTimeout(retry);
      setOnline(false);
    };
    // the whole link pasted over a cut-off one in the same tab changes only what follows the #, which loads no page
    const onLink = () => {
      setStatus('connecting');
      void attach();
    };

    socket.on('stage:state', onState);
    socket.on('room:closed', onClosed);
    socket.on('connect', attach);
    socket.on('disconnect', onDown);
    if (role === 'stage') window.addEventListener('hashchange', onLink);
    if (socket.connected) void attach();
    const stopSync = keepClockSynced(socket);
    return () => {
      alive = false;
      clearTimeout(retry);
      stopSync();
      socket.off('stage:state', onState);
      socket.off('room:closed', onClosed);
      socket.off('connect', attach);
      socket.off('disconnect', onDown);
      window.removeEventListener('hashchange', onLink);
      // moving to another page keeps the tab's connection, which would otherwise keep watching the room
      socket.emit('stage:leave');
    };
  }, [pin, role]);

  return { state, status, online, stageToken };
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
