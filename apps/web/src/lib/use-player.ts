'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerSent, PlayerState, Result } from '@icebreaker/shared';
import { keepClockSynced, syncClock } from './clock';
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
/** how long to wait before asking to come back in again, after no answer or being told to slow down */
const RETRY_MS = 5000;

/** An ack that never arrived (server down, bad network) becomes an ordinary error. */
async function ack<T extends object>(p: Promise<Result<T>>): Promise<Result<T> | { ok: false; error: 'timeout' }> {
  try {
    return await p;
  } catch {
    return { ok: false, error: 'timeout' };
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
  /** the question this tab has sent an answer to, until answering moves on */
  const answering = useRef<string | null>(null);

  /**
   * Back in as the same player. 'later' when there was no answer or the server said to slow down: the session
   * stays, to try again, as only a room that is gone or a token it no longer takes ends it.
   */
  const resume = useCallback(async (p: string): Promise<'ok' | 'none' | 'later'> => {
    const session = load<PlayerSession | null>(keys.playerSession(p), null);
    if (!session) return 'none';
    const res = await ack(getSocket().timeout(8000).emitWithAck('player:resume', { pin: p, token: session.token }));
    if (res.ok) {
      joined.current = true;
      setStatus('playing');
      return 'ok';
    }
    if (res.error === 'timeout' || res.error === 'rate_limited') return 'later';
    remove(keys.playerSession(p));
    if (joined.current) setStatus(res.error === 'room_not_found' ? 'closed' : 'kicked');
    return 'none';
  }, []);

  // live updates for this room
  useEffect(() => {
    if (!pin) return;
    const socket = getSocket();
    const onState = (s: PlayerState) => {
      if (s.pin !== pin) return;
      if (s.phase !== 'question') answering.current = null;
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
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // with no answer, again in a while, for as long as the connection holds; a reconnect asks anyway
    const rejoin = async () => {
      clearTimeout(retry);
      const back = await resume(pin);
      if (back !== 'later') setOnline(true);
      else if (alive && socket.connected && joined.current) retry = setTimeout(() => void rejoin(), RETRY_MS);
    };
    const onConnect = () => {
      void syncClock(socket);
      // in a room, the banner stays up until the server has this phone back as the same player
      if (joined.current) void rejoin();
      else setOnline(true);
    };
    const onDown = () => {
      clearTimeout(retry);
      setOnline(false);
    };
    socket.on('player:state', onState);
    socket.on('player:kicked', onKicked);
    socket.on('room:closed', onClosed);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDown);
    const stopSync = keepClockSynced(socket);
    return () => {
      alive = false;
      clearTimeout(retry);
      stopSync();
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
      // with no answer yet the page keeps asking, rather than let go of the player this phone was
      let resumed = await resume(initialPin);
      while (resumed === 'later' && alive) {
        await new Promise((r) => setTimeout(r, RETRY_MS));
        if (alive) resumed = await resume(initialPin);
      }
      if (!alive || resumed === 'ok') return;
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

  /**
   * False when this tab has already answered the question: two taps closer together than a screen update
   * would otherwise send both, and the phone would show the second while the server keeps the first.
   */
  const answer = useCallback((questionId: string, sent: AnswerSent) => {
    if (answering.current === questionId) return false;
    answering.current = questionId;
    setPicked({ questionId, sent, late: false });
    void ack(getSocket().timeout(5000).emitWithAck('player:answer', { questionId, ...sent })).then((res) => {
      if (res.ok) return;
      if (res.error === 'too_late' || res.error === 'not_open') setPicked({ questionId, sent, late: true });
      // refused (a value the question can't take): back to the answer pad rather than a stuck "sent"
      else if (res.error === 'bad_request') {
        if (answering.current === questionId) answering.current = null;
        setPicked((p) => (p?.questionId === questionId ? null : p));
      }
    });
    return true;
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
