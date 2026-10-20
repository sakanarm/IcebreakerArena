'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerSent, PlayerState, Result } from '@icebreaker/shared';
import { syncClock } from './clock';
import { withBase } from './paths';
import { getSocket } from './socket';
import { keys, load, remove, save, type PlayerSession } from './storage';

export type PlayerStatus = 'checking' | 'need_pin' | 'need_name' | 'joining' | 'playing' | 'kicked' | 'closed';

const MESSAGES: Record<string, string> = {
  room_not_found: 'ไม่พบห้องนี้ ลองตรวจ PIN อีกครั้ง',
  room_full: 'ห้องนี้เต็มแล้ว',
  rate_limited: 'ลองถี่เกินไป รอสักครู่แล้วลองใหม่',
  timeout: 'เชื่อมต่อเกมเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง',
};
const messageFor = (code: string) => MESSAGES[code] ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';

/** An ack that never arrived (server down, bad network) becomes an ordinary error. */
async function ack<T extends object>(p: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await p;
  } catch {
    return { ok: false, error: 'timeout' as never };
  }
}

export interface Picked {
  questionId: string;
  sent: AnswerSent;
  late: boolean;
}

export function usePlayer(initialPin: string | null) {
  const [pin, setPin] = useState(initialPin);
  const [roomTitle, setRoomTitle] = useState('');
  const [status, setStatus] = useState<PlayerStatus>(initialPin ? 'checking' : 'need_pin');
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [picked, setPicked] = useState<Picked | null>(null);
  /** true once this tab is in the room, so a reconnect knows to resume */
  const joined = useRef(false);

  const resume = useCallback(async (p: string) => {
    const session = load<PlayerSession | null>(keys.playerSession(p), null);
    if (!session) return false;
    const res = await ack(getSocket().timeout(8000).emitWithAck('player:resume', { pin: p, token: session.token }));
    if (res.ok) {
      joined.current = true;
      setStatus('playing');
      return true;
    }
    remove(keys.playerSession(p));
    if (joined.current) setStatus(res.error === 'room_not_found' ? 'closed' : 'kicked');
    return false;
  }, []);

  // live updates for this room
  useEffect(() => {
    if (!pin) return;
    const socket = getSocket();
    const onState = (s: PlayerState) => {
      if (s.pin !== pin) return;
      setState(s);
      setStatus('playing');
    };
    const end = (why: 'kicked' | 'closed') => () => {
      joined.current = false;
      remove(keys.playerSession(pin));
      setStatus(why);
    };
    const onKicked = end('kicked');
    const onClosed = end('closed');
    const onConnect = () => {
      setOnline(true);
      void syncClock(socket);
      if (joined.current) void resume(pin);
    };
    const onDown = () => setOnline(false);
    socket.on('player:state', onState);
    socket.on('player:kicked', onKicked);
    socket.on('room:closed', onClosed);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDown);
    if (socket.connected) void syncClock(socket);
    return () => {
      socket.off('player:state', onState);
      socket.off('player:kicked', onKicked);
      socket.off('room:closed', onClosed);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDown);
    };
  }, [pin, resume]);

  // opened with ?pin=…: come back to the same player after a refresh, or ask for a name
  useEffect(() => {
    if (!initialPin) return;
    let alive = true;
    void (async () => {
      if (await resume(initialPin)) return;
      const res = await ack(getSocket().timeout(8000).emitWithAck('room:check', initialPin));
      if (!alive) return;
      if (res.ok) {
        setRoomTitle(res.title);
        setStatus('need_name');
      } else {
        setError(messageFor(res.error));
        setStatus('need_pin');
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialPin, resume]);

  const checkPin = useCallback(async (p: string) => {
    setError(null);
    const res = await ack(getSocket().timeout(8000).emitWithAck('room:check', p));
    if (!res.ok) {
      setError(messageFor(res.error));
      return false;
    }
    setPin(p);
    setRoomTitle(res.title);
    setStatus('need_name');
    history.replaceState(null, '', withBase(`/play?pin=${p}`));
    return true;
  }, []);

  const join = useCallback(
    async (nickname: string, avatar: string) => {
      if (!pin) return;
      setError(null);
      setStatus('joining');
      const res = await ack(getSocket().timeout(8000).emitWithAck('player:join', { pin, nickname, avatar }));
      if (!res.ok) {
        setError(messageFor(res.error));
        setStatus(res.error === 'room_not_found' ? 'need_pin' : 'need_name');
        return;
      }
      save(keys.playerSession(pin), { token: res.token, playerId: res.playerId, nickname: res.nickname });
      save(keys.profile, { nickname, avatar });
      joined.current = true;
      setStatus('playing');
    },
    [pin],
  );

  const answer = useCallback(async (questionId: string, sent: AnswerSent) => {
    setPicked({ questionId, sent, late: false });
    const res = await ack(getSocket().timeout(5000).emitWithAck('player:answer', { questionId, ...sent }));
    if (res.ok) return;
    if (res.error === 'too_late' || res.error === 'not_open') setPicked({ questionId, sent, late: true });
    // refused (a value the question can't take): back to the answer pad rather than a stuck "sent"
    else if (res.error === 'bad_request') setPicked((p) => (p?.questionId === questionId ? null : p));
  }, []);

  /** back to the PIN screen, or with `rejoin` straight to this room's name screen ("change name" in the lobby) */
  const leave = useCallback(
    async (rejoin = false) => {
      if (pin) remove(keys.playerSession(pin));
      // let the server free our lobby spot first, so the big screen doesn't keep a ghost of the old name
      if (joined.current) await ack(getSocket().timeout(1500).emitWithAck('player:leave'));
      joined.current = false;
      location.href = withBase(rejoin && pin ? `/play?pin=${pin}` : '/play');
    },
    [pin],
  );

  // the server's record wins; the local pick covers the moment before it arrives
  const q = state?.question;
  const localPick = q && picked?.questionId === q.id ? picked : null;
  const myAnswer = state?.myAnswer ?? localPick?.sent ?? null;

  return { pin, roomTitle, status, state, error, online, myAnswer, late: !!localPick?.late, checkPin, join, answer, leave };
}
