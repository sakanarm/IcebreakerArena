'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { PlayerMe, PlayerState } from '@icebreaker/shared';
import { burst } from '@/lib/confetti';
import { fmt } from '@/lib/format';
import { sfx, vibrate } from '@/lib/sfx';
import { CountUp } from '../motion-bits';
import { ANSWER_BG, AnswerShape } from '../shapes';
import { untimed } from './PlayerQuestion';

type Kind = 'right' | 'wrong' | 'poll' | 'missed';

const LOOK: Record<Kind, { bg: string; icon: string; title: string }> = {
  right: { bg: 'bg-good', icon: '✓', title: 'ถูกต้อง!' },
  wrong: { bg: 'bg-bad', icon: '✗', title: 'ยังไม่ถูก' },
  poll: { bg: 'bg-ans-3', icon: '🗳️', title: 'โหวตแล้ว!' },
  missed: { bg: 'bg-slate-600', icon: '😴', title: 'ไม่ทันตอบ' },
};

const CHEERS = ['ไม่เป็นไร ข้อหน้าเอาใหม่!', 'เกือบแล้ว!', 'สู้ๆ ยังมีลุ้น!', 'พลาดนิดเดียวเอง'];

/** Full-screen green / red result after each reveal, Kahoot style. */
export function PlayerResult({ state }: { state: PlayerState }) {
  const r = state.result;
  const kind: Kind = !r || !r.answered ? 'missed' : r.correct === null ? 'poll' : r.correct ? 'right' : 'wrong';
  const look = LOOK[kind];
  const [cheer] = useState(() => CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  const showAnswer = (kind === 'wrong' || kind === 'missed') && state.question && state.correctChoices?.length;

  useEffect(() => {
    if (kind === 'right') {
      sfx.play('correct');
      vibrate([40, 40, 90]);
      burst({ x: 0.5, y: 0.35 }, 90);
    } else if (kind === 'wrong') {
      sfx.play('wrong');
      vibrate(250);
    }
  }, [kind]);

  return (
    <div className="relative isolate flex flex-1 flex-col items-center justify-center gap-5 text-center">
      {/* the color floods out from the middle of the screen */}
      <motion.div
        aria-hidden
        className={`fixed top-1/2 left-1/2 -z-10 size-[300vmax] -translate-x-1/2 -translate-y-1/2 rounded-full ${look.bg}`}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <motion.div
        initial={{ scale: 0, rotate: -120 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 320, damping: 13 }}
        className="grid size-28 place-items-center rounded-full bg-white text-6xl font-extrabold text-ink shadow-2xl"
      >
        <span className={kind === 'right' ? 'text-good' : kind === 'wrong' ? 'text-bad' : ''}>{look.icon}</span>
      </motion.div>
      <motion.h2
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="text-4xl font-extrabold drop-shadow"
      >
        {look.title}
      </motion.h2>

      {r && r.points > 0 && (
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 16 }}
          className="rounded-full bg-black/25 px-6 py-2 font-display text-3xl font-extrabold"
        >
          +<CountUp to={r.points} duration={0.9} delay={0.55} />
        </motion.div>
      )}

      {kind === 'right' && state.question && untimed(state.question) && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }} className="rounded-full bg-white/20 px-4 py-1 text-sm">
          ⏱️ ไม่นับความเร็ว ตอบถูกได้เต็ม
        </motion.p>
      )}

      {kind === 'right' && r && r.streak >= 2 && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.75 }}
          className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 font-semibold"
        >
          <motion.span animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }} aria-hidden>
            🔥
          </motion.span>
          ตอบถูกติดกัน {r.streak} ข้อ
        </motion.div>
      )}

      {kind === 'wrong' && <p className="text-lg text-white/90">{cheer}</p>}
      {kind === 'missed' && <p className="text-lg text-white/90">ข้อหน้ากดให้ทันนะ!</p>}

      {showAnswer && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="w-full max-w-sm">
          <p className="mb-2 text-sm text-white/80">คำตอบที่ถูก</p>
          <div className="flex flex-col gap-2">
            {state.correctChoices!.map((i) => (
              <div key={i} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left ring-2 ring-white/70 ${ANSWER_BG[i]}`}>
                <AnswerShape index={i} className="size-7 shrink-0 text-white" />
                <span className="font-semibold">{state.question!.options[i]}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <RankLine me={state.me} />
    </div>
  );
}

/** "2nd place, 120 points behind Panda": the reason to try harder on the next question. */
export function RankLine({ me, delay = 0.9 }: { me: PlayerMe; delay?: number }) {
  if (me.rank === null) return null;
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay }}
      className="rounded-2xl bg-black/25 px-5 py-3 text-center"
    >
      <div className="font-display text-xl font-semibold">
        อันดับที่ {fmt(me.rank)} <span className="text-base font-normal text-white/75">จาก {fmt(me.totalPlayers)} คน</span>
      </div>
      <div className="mt-0.5 text-white/85">
        {me.rank === 1
          ? '👑 คุณนำอยู่! รักษาไว้นะ'
          : me.gapToAbove !== null && me.aboveNickname
            ? `ตามหลัง ${me.aboveNickname} อยู่ ${fmt(me.gapToAbove)} แต้ม`
            : 'สู้ต่อ!'}
      </div>
    </motion.div>
  );
}
