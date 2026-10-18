'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SAMPLE_GAMES, validateGame, type Game } from '@icebreaker/shared';
import { copyGame, countQuestions, deleteMyGame, dropBlankOptions, listMyGames, saveMyGame } from '@/lib/games';
import { createRoom } from '@/lib/host';
import { ANSWER_BG, AnswerShape, FloatingShapes, Logo } from '../shapes';

/** Host home: pick one of your games (or a sample) and open a live room for it. */
export function GamePicker() {
  const router = useRouter();
  const [mine, setMine] = useState<Game[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // saved games live in localStorage, which only exists after mount
  useEffect(() => setMine(listMyGames()), []);

  const start = async (game: Game) => {
    setError(null);
    setStarting(game.id);
    const res = await createRoom(game);
    if (res.ok) return router.push(`/host/${res.pin}`);
    setError(res.message);
    setStarting(null);
  };

  const copyToEdit = (game: Game) => {
    const copy = copyGame(game);
    saveMyGame(copy);
    router.push(`/editor?id=${copy.id}`);
  };

  const remove = (game: Game) => {
    if (!confirm(`ลบเกม “${game.title || 'ไม่มีชื่อ'}” ใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    deleteMyGame(game.id);
    setMine(listMyGames());
  };

  return (
    <div className="relative min-h-dvh px-5 pt-6 pb-16">
      <FloatingShapes opacity={0.07} />
      <div className="relative mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" aria-label="กลับหน้าแรก">
            <Logo small />
          </Link>
          <Link href="/editor" className="btn btn-gold">
            ＋ สร้างเกมใหม่
          </Link>
        </header>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-10">
          <h1 className="text-4xl font-extrabold md:text-5xl">เลือกเกมที่จะเล่น</h1>
          <p className="mt-2 text-lg text-white/70">กด “เริ่มห้อง” แล้วเปิดจอนี้ขึ้นโปรเจกเตอร์ ให้ทุกคนสแกน QR หรือใส่ PIN</p>
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.div
              role="alert"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-bad/90 px-5 py-4 font-semibold">
                <span aria-hidden>⚠️</span>
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} className="text-white/80" aria-label="ปิดข้อความ">
                  ✕
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Section title="เกมของฉัน" note="บันทึกไว้ในเบราว์เซอร์นี้">
          {mine === null ? null : mine.length === 0 ? (
            <EmptyMine />
          ) : (
            mine.map((g, i) => {
              // a half-written game can't open a room, so send it back to the editor instead
              const ready = validateGame(dropBlankOptions(g)).ok;
              return (
                <GameCard
                  key={g.id}
                  game={g}
                  index={i}
                  busy={starting === g.id}
                  locked={!!starting}
                  onStart={start}
                  fixHref={ready ? null : `/editor?id=${g.id}`}
                >
                  {ready && (
                    <Link href={`/editor?id=${g.id}`} className="btn bg-slate-100 px-4 text-base text-ink">
                      ✏️ แก้ไข
                    </Link>
                  )}
                  <button type="button" onClick={() => remove(g)} className="btn bg-slate-100 px-3 text-base text-bad" aria-label={`ลบ ${g.title}`}>
                    🗑️
                  </button>
                </GameCard>
              );
            })
          )}
        </Section>

        <Section title="เกมตัวอย่าง" note="เล่นได้ทันที หรือทำสำเนาไปแก้เป็นของทีมคุณ">
          {SAMPLE_GAMES.map((g, i) => (
            <GameCard key={g.id} game={g} index={i + 2} sample busy={starting === g.id} locked={!!starting} onStart={start}>
              <button type="button" onClick={() => copyToEdit(g)} className="btn bg-slate-100 px-4 text-base text-ink">
                📄 ทำสำเนาไปแก้
              </button>
            </GameCard>
          ))}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-2xl font-bold">{title}</h2>
        <span className="text-sm text-white/55">{note}</span>
      </div>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function GameCard({
  game,
  index,
  sample = false,
  busy,
  locked,
  onStart,
  fixHref = null,
  children,
}: {
  game: Game;
  index: number;
  sample?: boolean;
  busy: boolean;
  locked: boolean;
  onStart: (game: Game) => void;
  /** set when the game is incomplete: the main button leads to the editor instead of opening a room */
  fixHref?: string | null;
  children: React.ReactNode;
}) {
  const color = index % 4;
  return (
    <motion.article
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: Math.min(index, 8) * 0.06, type: 'spring', stiffness: 260, damping: 24 }}
      whileHover={{ y: -6 }}
      className="card flex flex-col overflow-hidden"
    >
      <div className={`relative flex h-24 items-end justify-between overflow-hidden px-5 pb-3 ${ANSWER_BG[color]}`}>
        <AnswerShape index={color} className="absolute -top-6 -right-4 size-32 rotate-12 text-white/20" />
        <span className="relative rounded-full bg-black/20 px-3 py-1 text-sm font-semibold text-white">
          {game.rounds.length} ด่าน · {countQuestions(game)} ข้อ
        </span>
        {sample && <span className="relative rounded-full bg-white px-3 py-1 text-xs font-bold text-ink">ตัวอย่าง</span>}
        {fixHref && <span className="relative rounded-full bg-gold px-3 py-1 text-xs font-bold text-ink">⚠️ ยังไม่ครบ</span>}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-2 text-xl font-bold">{game.title || 'เกมไม่มีชื่อ'}</h3>
        {game.description && <p className="mt-1 line-clamp-2 text-slate-500">{game.description}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {fixHref ? (
            <Link href={fixHref} className="btn btn-gold flex-1 text-base">
              ✏️ แก้ให้ครบ
            </Link>
          ) : (
            <button type="button" disabled={locked} onClick={() => onStart(game)} className="btn btn-primary flex-1 text-base">
              {busy ? 'กำลังเปิดห้อง…' : '▶ เริ่มห้อง'}
            </button>
          )}
          {children}
        </div>
      </div>
    </motion.article>
  );
}

function EmptyMine() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass flex flex-col items-center gap-3 p-8 text-center sm:col-span-2 lg:col-span-3"
    >
      <span className="animate-wiggle text-5xl" aria-hidden>
        ✍️
      </span>
      <p className="text-lg font-semibold">ยังไม่มีเกมของคุณ</p>
      <p className="max-w-md text-white/65">สร้างเกมแรกได้ในไม่กี่นาที หรือทำสำเนาเกมตัวอย่างด้านล่างไปแก้ต่อ</p>
      <Link href="/editor" className="btn btn-primary mt-2">
        ＋ สร้างเกมแรก
      </Link>
    </motion.div>
  );
}
