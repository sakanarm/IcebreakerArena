'use client';

import { motion, useAnimate } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ANSWER_BG, AnswerShape, FloatingShapes, Logo } from '../shapes';

const FEATURES = [
  { title: 'เล่นพร้อมกันทั้งออฟฟิศ', body: 'สแกน QR หรือใส่ PIN จากมือถือ ไม่ต้องลงแอป ไม่ต้องสมัคร', emoji: '📱' },
  { title: 'หลายด่าน คะแนนทวีคูณ', body: 'แบ่งเกมเป็นด่าน ด่านท้ายคูณ ×2 ให้คนตามหลังมีลุ้นพลิก', emoji: '🚀' },
  { title: 'อันดับสด + โพเดียม', body: 'ตารางคะแนนสลับอันดับให้เห็นสดๆ ปิดท้ายด้วยโพเดียมและพลุ', emoji: '🏆' },
  { title: 'รายงานผลทันที', body: 'ดูว่าข้อไหนยาก ใครตอบไวสุด แล้วส่งออกเป็น CSV ได้', emoji: '📊' },
];

const STEPS = [
  { title: 'เลือกหรือสร้างเกม', body: 'ใช้เกมตัวอย่าง หรือเขียนคำถามของทีมเองใน Editor' },
  { title: 'เปิดห้อง ขึ้นจอใหญ่', body: 'กดเริ่มห้อง ได้ PIN และ QR Code บนโปรเจกเตอร์' },
  { title: 'ทุกคนเข้าเล่นจากมือถือ', body: 'ตอบให้ถูกและไว เก็บคะแนน ลุ้นขึ้นโพเดียม' },
];

export function HomeScreen() {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <FloatingShapes opacity={0.09} />
      <div className="relative mx-auto flex max-w-6xl flex-col px-5 pt-6 pb-16">
        <header className="flex items-center justify-between gap-4">
          <Logo small />
          <nav className="flex gap-2">
            <Link href="/host" className="btn btn-ghost px-4 text-base">
              จัดเกม
            </Link>
            <Link href="/editor" className="btn btn-ghost hidden px-4 text-base sm:inline-flex">
              สร้างเกม
            </Link>
          </nav>
        </header>

        {/* grid-cols-1 keeps the PIN input's intrinsic width from stretching the column past a phone screen */}
        <section className="mt-10 grid grid-cols-1 items-center gap-10 lg:mt-16 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <motion.p
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="inline-flex rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold text-brand-2"
            >
              Icebreaker & Quiz สำหรับทีม MFEC
            </motion.p>
            <motion.h1
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.08 }}
              className="mt-4 text-5xl leading-[1.15] font-extrabold md:text-6xl"
            >
              ละลายพฤติกรรม
              <br />
              <span className="bg-linear-to-r from-gold via-ans-0 to-ans-2 bg-clip-text text-transparent">ด้วยเกมที่ทุกคนเล่นพร้อมกัน</span>
            </motion.h1>
            <motion.p
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.16 }}
              className="mt-5 max-w-xl text-lg text-white/75"
            >
              สร้างคำถามเอง แบ่งเป็นหลายด่าน แข่งเก็บคะแนนแบบเรียลไทม์บนจอใหญ่ ทุกคนตอบจากมือถือของตัวเอง
            </motion.p>
            <QuickJoin />
          </div>
          <HeroTiles />
        </section>

        <section className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-24">
          <ActionCard href="/host" color={1} title="จัดเกม (Host)" body="เลือกเกม เปิดห้อง แล้วคุมจังหวะบนจอใหญ่ด้วยปุ่มเดียว" cta="ไปหน้าจัดเกม" />
          <ActionCard href="/editor" color={3} title="สร้างเกมของทีม" body="เขียนคำถาม 4 ตัวเลือก จริง/เท็จ หรือโพลโหวต จัดเป็นด่านๆ" cta="เปิด Editor" />
        </section>

        <section className="mt-16 lg:mt-24">
          <h2 className="text-3xl font-extrabold">ทำไมทีมถึงชอบ</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ y: 30, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: i * 0.08, type: 'spring', stiffness: 220, damping: 22 }}
                whileHover={{ y: -6 }}
                className="glass p-6"
              >
                <div className={`grid size-12 place-items-center rounded-2xl text-2xl ${ANSWER_BG[i % 4]}`} aria-hidden>
                  {f.emoji}
                </div>
                <h3 className="mt-4 text-xl font-bold">{f.title}</h3>
                <p className="mt-2 text-white/70">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mt-16 lg:mt-24">
          <h2 className="text-3xl font-extrabold">เริ่มได้ใน 3 ขั้น</h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.title}
                initial={{ x: -20, opacity: 0 }}
                whileInView={{ x: 0, opacity: 1 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: i * 0.12 }}
                className="flex gap-4 rounded-3xl bg-white/5 p-5"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white font-display text-2xl font-extrabold text-ink">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-lg font-bold">{s.title}</h3>
                  <p className="mt-1 text-white/70">{s.body}</p>
                </div>
              </motion.li>
            ))}
          </ol>
        </section>

        <footer className="mt-20 text-center text-sm text-white/40">MFEC IceBreaker Arena · ใช้ภายในองค์กร</footer>
      </div>
    </div>
  );
}

/** The fastest way in: type the PIN from the big screen right on the home page. */
function QuickJoin() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [scope, animate] = useAnimate<HTMLFormElement>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) return void animate(scope.current, { x: [0, -12, 12, -8, 8, 0] }, { duration: 0.4 });
    router.push(`/play?pin=${pin}`);
  };

  return (
    <motion.form
      ref={scope}
      onSubmit={submit}
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.24 }}
      className="card mt-8 flex max-w-md items-center gap-2 p-2"
    >
      <label htmlFor="home-pin" className="sr-only">
        PIN เกม
      </label>
      <input
        id="home-pin"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        placeholder="ใส่ PIN 6 หลัก"
        className="w-full min-w-0 flex-1 bg-transparent px-4 py-2 text-center font-display text-3xl font-extrabold tracking-[0.25em] text-ink outline-none placeholder:text-lg placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400"
      />
      <button type="submit" className="btn btn-primary shrink-0">
        เข้าเกม
      </button>
    </motion.form>
  );
}

/** Four answer tiles that drop in and keep bobbing: the game in one picture. */
function HeroTiles() {
  return (
    <div className="mx-auto grid w-full max-w-sm grid-cols-2 gap-4 lg:max-w-md" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          initial={{ y: -80, opacity: 0, rotate: i % 2 ? 12 : -12 }}
          animate={{ y: 0, opacity: 1, rotate: i % 2 ? 3 : -3 }}
          transition={{ delay: 0.3 + i * 0.12, type: 'spring', stiffness: 260, damping: 14 }}
          whileHover={{ scale: 1.06, rotate: 0 }}
          className={`grid aspect-square place-items-center rounded-[2rem] shadow-[inset_0_-10px_0_rgb(0_0_0/0.25)] ${ANSWER_BG[i]}`}
        >
          <div className="animate-bob" style={{ animationDelay: `${i * 0.3}s` }}>
            <AnswerShape index={i} className="size-20 text-white drop-shadow-lg md:size-24" />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ActionCard({ href, color, title, body, cta }: { href: string; color: number; title: string; body: string; cta: string }) {
  return (
    <motion.div initial={{ y: 30, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} whileHover={{ y: -6 }}>
      <Link href={href} className={`group relative flex h-full flex-col overflow-hidden rounded-3xl p-7 shadow-xl ${ANSWER_BG[color]}`}>
        <AnswerShape index={color} className="absolute -right-6 -bottom-8 size-44 text-white/15 transition-transform duration-500 group-hover:rotate-12" />
        <h3 className="relative text-3xl font-extrabold">{title}</h3>
        <p className="relative mt-2 max-w-sm text-lg text-white/85">{body}</p>
        <span className="relative mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2 font-display font-semibold text-ink">
          {cta} <span className="transition-transform group-hover:translate-x-1">→</span>
        </span>
      </Link>
    </motion.div>
  );
}
