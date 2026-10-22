'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { PlayerMe, RoundInfo } from '@icebreaker/shared';
import { burst, shower } from '@/lib/confetti';
import { fmt } from '@/lib/format';
import { FALL_S, MEDAL_S, RIDER_S, medalFall, phoneRevealAt } from '@/lib/podium';
import { sfx, vibrate } from '@/lib/sfx';
import { CountUp, WaitingDots } from '../motion-bits';
import { ANSWER_BG } from '../shapes';
import { RankLine } from './PlayerResult';

/** In the room, waiting for the Host to start. Tapping your avatar makes it jump. */
export function PlayerLobby({ me, onLeave }: { me: PlayerMe; onLeave: () => void }) {
  const [jumps, setJumps] = useState(0);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <motion.button
        type="button"
        key={jumps}
        onClick={() => {
          setJumps((n) => n + 1);
          sfx.play('pop');
          vibrate(15);
        }}
        initial={jumps ? { y: -40, rotate: -15 } : { scale: 0, rotate: -30 }}
        animate={{ y: 0, scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 12 }}
        className="grid size-36 place-items-center rounded-full bg-white text-8xl shadow-2xl"
        aria-label="แตะเพื่อให้ตัวละครกระโดด"
      >
        <span className="animate-bob inline-block">{me.avatar}</span>
      </motion.button>
      <motion.h2
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="max-w-full truncate text-3xl font-extrabold"
      >
        {me.nickname}
      </motion.h2>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="glass px-6 py-4">
        <p className="text-xl font-semibold">เข้ามาแล้ว! 🎉</p>
        <p className="mt-1 text-white/75">เห็นชื่อตัวเองบนจอใหญ่ไหม?</p>
      </motion.div>
      <p className="flex items-center gap-2 text-white/70">
        รอผู้จัดเริ่มเกม <WaitingDots />
      </p>
      <button type="button" onClick={onLeave} className="text-sm text-white/50 underline underline-offset-4">
        เปลี่ยนชื่อ / ตัวละคร
      </button>
    </div>
  );
}

/** "Round 2: Tech Trivia" in the round's color, while the big screen plays its intro. */
export function PlayerRound({ round }: { round: RoundInfo }) {
  useEffect(() => vibrate([20, 60, 20]), []);
  return (
    <div className="relative isolate flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <motion.div
        aria-hidden
        className={`fixed inset-0 -z-10 origin-left ${ANSWER_BG[round.index % 4]}`}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.45, ease: [0.7, 0, 0.2, 1] }}
      />
      <motion.span
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="rounded-full bg-black/20 px-4 py-1 font-display text-lg font-semibold"
      >
        ด่าน {round.index + 1} / {round.total}
      </motion.span>
      <motion.h2
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, type: 'spring', stiffness: 260, damping: 16 }}
        className="text-5xl font-extrabold drop-shadow-lg"
      >
        {round.title}
      </motion.h2>
      {round.subtitle && <p className="text-lg text-white/90">{round.subtitle}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {round.multiplier > 1 && (
          <motion.span
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="rounded-full bg-gold px-4 py-1.5 font-display font-extrabold text-ink"
          >
            คะแนน ×{round.multiplier}
          </motion.span>
        )}
        {!round.timed && <span className="rounded-full bg-black/20 px-4 py-1.5">⏱️ ไม่นับความเร็ว ขอแค่ตอบถูก</span>}
      </div>
      <p className="mt-4 text-lg font-semibold text-white/90">เตรียมตัว! {round.questionCount} ข้อ</p>
    </div>
  );
}

/** Between questions: where you stand, and how far the next person up is. */
export function PlayerRank({ me }: { me: PlayerMe }) {
  const top5 = me.rank !== null && me.rank <= 5;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <p className="text-lg text-white/75">อันดับของคุณตอนนี้</p>
      <motion.div
        initial={{ scale: 0.3, rotate: -15, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className={`grid size-40 place-items-center rounded-full font-display text-7xl font-extrabold shadow-2xl ${top5 ? 'bg-gold text-ink' : 'bg-white text-ink'}`}
      >
        {me.rank ?? '–'}
      </motion.div>
      <div className="font-display text-3xl font-extrabold">
        <CountUp to={me.score} duration={1} /> <span className="text-lg font-normal text-white/70">แต้ม</span>
      </div>
      {top5 && (
        <motion.p initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }} className="text-lg font-semibold text-gold">
          ติด Top 5 บนจอใหญ่! 🎉
        </motion.p>
      )}
      <RankLine me={me} delay={0.6} />
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];
const MEDAL_RAYS = [
  'bg-[repeating-conic-gradient(rgb(255_214_90/0.4)_0_10deg,transparent_10deg_30deg)]',
  'bg-[repeating-conic-gradient(rgb(226_232_240/0.35)_0_10deg,transparent_10deg_30deg)]',
  'bg-[repeating-conic-gradient(rgb(253_186_116/0.35)_0_10deg,transparent_10deg_30deg)]',
];
/** ms after a medal's result comes up that it lands, as it lands on its name on the big screen */
const LAND_MS = (MEDAL_S - RIDER_S + FALL_S) * 1000;

/** Final result: waits for the big screen's podium reveal, then shows your place. */
export function PlayerFinal({ me, onPlayAgain }: { me: PlayerMe; onPlayAgain: () => void }) {
  const [shown, setShown] = useState(false);
  const medal = me.rank !== null && me.rank <= 3 ? MEDALS[me.rank - 1] : null;
  const reduce = useReducedMotion();

  useEffect(() => {
    // the top three as their name comes onto the stand on the big screen, everyone else after the winner's
    const t = setTimeout(() => setShown(true), phoneRevealAt(me.rank));
    return () => clearTimeout(t);
  }, [me.rank]);

  useEffect(() => {
    if (!shown || !medal) return;
    // as the medal lands, here and on the big screen
    const t = setTimeout(() => {
      vibrate([60, 40, 60, 40, 120]);
      if (me.rank === 1) shower(2500);
      else burst({ x: 0.5, y: 0.35 }, 120);
    }, LAND_MS);
    return () => clearTimeout(t);
  }, [shown, medal, me.rank]);

  if (!shown) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <motion.span className="text-7xl" animate={{ rotate: [-8, 8] }} transition={{ duration: 0.18, repeat: Infinity, repeatType: 'reverse' }} aria-hidden>
          🥁
        </motion.span>
        <p className="flex items-center gap-2 text-2xl font-semibold">
          กำลังประกาศผล <WaitingDots />
        </p>
        <p className="text-white/70">ดูที่จอใหญ่เลย!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      {medal ? (
        <div data-my-medal={me.rank} className="relative grid size-44 place-items-center">
          {!reduce && (
            <>
              {/* light turning behind the medal, in its color */}
              <motion.span
                data-rays
                aria-hidden
                className="absolute -inset-16"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: LAND_MS / 1000, duration: 0.4 }}
              >
                <span className={`animate-rays block size-full rounded-full ${MEDAL_RAYS[me.rank! - 1]} [mask-image:radial-gradient(closest-side,black_30%,transparent)]`} />
              </motion.span>
              <motion.span
                aria-hidden
                className={`absolute inset-6 rounded-full border-8 ${me.rank === 1 ? 'border-gold' : 'border-white'}`}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 2, opacity: [0, 0.9, 0] }}
                transition={{ delay: LAND_MS / 1000, duration: 0.7, ease: 'easeOut' }}
              />
            </>
          )}
          <motion.span data-medal className="relative text-9xl drop-shadow-xl" {...medalFall(260, MEDAL_S - RIDER_S)} aria-hidden>
            {medal}
          </motion.span>
        </div>
      ) : (
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 12 }}
          className="text-9xl drop-shadow-xl"
          aria-hidden
        >
          {me.avatar}
        </motion.div>
      )}
      <motion.h2
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: medal ? LAND_MS / 1000 : 0.3, opacity: { delay: medal ? LAND_MS / 1000 : 0.3, duration: 0.2 } }}
        className="text-4xl font-extrabold"
      >
        {me.rank === null ? 'จบเกมแล้ว!' : `อันดับที่ ${fmt(me.rank)}`}
      </motion.h2>
      <p className="text-lg text-white/80">
        {me.rank === 1 ? 'แชมป์! สุดยอดไปเลย 👑' : medal ? 'ขึ้นโพเดียมแล้ว เก่งมาก!' : `จาก ${fmt(me.totalPlayers)} คน ขอบคุณที่ร่วมสนุก!`}
      </p>
      <div className="rounded-2xl bg-black/25 px-6 py-3 font-display text-3xl font-extrabold">
        <CountUp to={me.score} duration={1.4} delay={0.4} /> <span className="text-lg font-normal text-white/70">แต้ม</span>
      </div>
      <button type="button" onClick={onPlayAgain} className="btn btn-light mt-4">
        เข้าเกมอื่น
      </button>
    </div>
  );
}
