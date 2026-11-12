'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { refreshAccount, useAccount } from '@/lib/account';
import { quizStatus, type QuizStatus } from '@/lib/ai-quiz';
import { api } from '@/lib/api';
import { FloatingShapes } from '../shapes';
import { SiteNav } from '../SiteNav';

type Pika = 'loading' | 'error' | { configured: boolean; hasEmail: boolean };

/**
 * /create: the one place that lists every way to make a question set (the AI from a document, the
 * Pika knowledge base, a spreadsheet, or by hand), says which suits what, and why one is not open yet,
 * so a maker never has to guess where a button went.
 */
export function CreateApp() {
  const account = useAccount();
  const ready = account.status === 'ready';
  const user = ready ? account.user : null;
  const accounts = ready && account.mode !== 'off';
  const [ai, setAi] = useState<QuizStatus | null>(null);
  const [pika, setPika] = useState<Pika>('loading');

  const userId = user?.id ?? null;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void quizStatus().then((s) => live && setAi(s));
    if (userId) {
      setPika('loading');
      api<{ configured: boolean; hasEmail: boolean }>('/pika/project').then(
        (p) => live && setPika({ configured: p.configured, hasEmail: p.hasEmail }),
        () => live && setPika('error'),
      );
    }
    return () => {
      live = false;
    };
  }, [ready, userId]);

  const login = (next: string) => `/login?next=${encodeURIComponent(next)}`;
  const signIn = (next: string): Way['state'] => ({ kind: 'login', href: login(next) });

  const aiState: Way['state'] = user && !user.can.aiQuiz
    ? { kind: 'off', badge: 'ปิดสิทธิ์อยู่', title: 'ผู้ดูแลระบบปิดสิทธิ์นี้สำหรับบัญชีของคุณ', text: 'บัญชีนี้ใช้ AI ออกข้อสอบไม่ได้ วิธีอื่นในหน้านี้ยังใช้ได้ตามปกติ ติดต่อผู้ดูแลระบบถ้าต้องการใช้' }
    : !ready || !ai
    ? { kind: 'loading' }
    : !ai.enabled
      ? { kind: 'off', title: 'ผู้ดูแลระบบยังไม่ได้เปิดใช้', text: 'วิธีนี้จะเปิดเมื่อผู้ดูแลระบบเชื่อมเว็บนี้กับบริการ AI ของบริษัท ระหว่างนี้ใช้คลังความรู้ Pika หรือนำเข้าจาก Excel ได้' }
      : !accounts
        ? { kind: 'off', title: 'ต้องมีระบบบัญชี', text: 'จำนวนครั้งที่ใช้ได้นับต่อคน เครื่องนี้ยังไม่ได้เปิดระบบบัญชี จึงยังใช้ไม่ได้' }
        : ai.needsLogin || !user
          ? signIn('/import?ai=1')
          : ai.left <= 0
            ? { kind: 'off', badge: 'ครบโควตาวันนี้', title: `วันนี้ใช้ครบ ${ai.perDay} ครั้งแล้ว`, text: 'ใช้ได้อีกครั้งพรุ่งนี้ ระหว่างนี้ใช้คลังความรู้ Pika นำเข้าจาก Excel หรือเขียนเองได้' }
            : { kind: 'go', href: '/import?ai=1', label: 'เริ่มให้ AI ออกข้อสอบ', note: `วันนี้ใช้ได้อีก ${ai.left} จาก ${ai.perDay} ครั้ง` };

  const pikaState: Way['state'] = !ready
    ? { kind: 'loading' }
    : !accounts
      ? { kind: 'off', title: 'ต้องมีระบบบัญชี', text: 'คลังความรู้ Pika เป็นของแต่ละคน เครื่องนี้ยังไม่ได้เปิดระบบบัญชี จึงยังใช้ไม่ได้' }
      : !user
        ? signIn('/pika')
        : !user.can.pika
          ? { kind: 'off', badge: 'ปิดสิทธิ์อยู่', title: 'ผู้ดูแลระบบปิดสิทธิ์นี้สำหรับบัญชีของคุณ', text: 'บัญชีนี้ใช้คลังความรู้ Pika ไม่ได้ วิธีอื่นในหน้านี้ยังใช้ได้ตามปกติ ติดต่อผู้ดูแลระบบถ้าต้องการใช้' }
        : pika === 'loading'
          ? { kind: 'loading' }
          : pika === 'error'
            ? { kind: 'go', href: '/pika', label: 'เปิดคลังความรู้' }
            : !pika.configured
              ? { kind: 'off', title: 'ยังไม่ได้เชื่อมกับ Pika', text: 'เว็บนี้ยังไม่ได้ตั้งค่าให้ต่อกับคลังความรู้ Pika ติดต่อผู้ดูแลระบบ' }
              : !pika.hasEmail
                ? {
                    kind: 'off',
                    badge: 'ต้องเพิ่มอีเมล',
                    title: 'บัญชีนี้ยังไม่มีอีเมล',
                    text: `คลังความรู้ของแต่ละคนผูกกับอีเมลบริษัท ให้ผู้ดูแลระบบเพิ่มอีเมลให้บัญชี “${user.name}” หรือเข้าสู่ระบบด้วยบัญชีบริษัท`,
                  }
                : { kind: 'go', href: '/pika', label: 'เปิดคลังความรู้' };

  const sheetGo: Way['state'] = { kind: 'go', href: '/import', label: 'นำเข้าไฟล์' };
  // the import page has its own retry when the account could not be read
  const sheetState: Way['state'] = account.status === 'error' ? sheetGo : !ready ? { kind: 'loading' } : accounts && !user ? signIn('/import') : sheetGo;
  const editorState: Way['state'] = { kind: 'go', href: '/editor', label: 'เปิด Editor' };

  const ways: Way[] = [
    {
      key: 'ai',
      icon: <SparkIcon />,
      tone: 'violet',
      title: 'ให้ AI ออกข้อสอบ',
      text: 'วางเนื้อหาหรืออัปโหลดไฟล์ Word แล้ว AI เขียนข้อสอบสี่ตัวเลือกพร้อมเฉลยและคำอธิบาย คุณตรวจแก้ได้ทุกข้อก่อนบันทึก',
      fits: ['เอกสารชิ้นเดียว เช่น นโยบาย คู่มือ บันทึกประชุม', 'ได้ 5–20 ข้อภายในไม่กี่นาที'],
      meta: 'Word (.docx) หรือข้อความ · 200–40,000 ตัวอักษร',
      state: aiState,
    },
    {
      key: 'pika',
      icon: <LibraryIcon />,
      tone: 'cyan',
      title: 'จากคลังความรู้ Pika',
      text: 'เพิ่มเอกสารเข้าคลังความรู้ส่วนตัว แล้วเลือกหน้าที่ต้องการมาตั้งเป็นข้อสอบ ทุกข้อแนบข้อความต้นฉบับไว้ให้ตรวจ',
      fits: ['เอกสารยาวหรือหลายไฟล์ เช่น สไลด์อบรม คู่มือระบบ', 'ต้องอ้างอิงต้นฉบับได้ทุกข้อ'],
      meta: 'PDF, Word, PowerPoint, Excel · ไฟล์ละไม่เกิน 20 MB',
      state: pikaState,
    },
    {
      key: 'sheet',
      icon: <SheetIcon />,
      tone: 'green',
      title: 'นำเข้าจาก Excel / CSV',
      text: 'มีคลังข้อสอบอยู่แล้ว นำเข้าได้ครั้งละหลายร้อยข้อ พร้อมเฉลยและคำอธิบาย ระบบตรวจทุกแถวและบอกแถวที่ต้องแก้ก่อนบันทึก',
      fits: ['คลังข้อสอบเดิมในไฟล์หรือ Google Sheets', 'ข้อสอบจำนวนมากที่ต้องสุ่มถามทุกครั้ง'],
      meta: '.xlsx, .csv หรือคัดลอกจากตาราง',
      state: sheetState,
    },
    {
      key: 'editor',
      icon: <PenIcon />,
      tone: 'amber',
      title: 'เขียนเอง',
      text: 'สร้างคำถามทีละข้อใน Editor ทั้งควิซสี่ตัวเลือก จริง/เท็จ โพลล์ และคำถามแบบอื่น ใส่รูป ตั้งเวลา และเขียนคำอธิบายเฉลยได้',
      fits: ['ชุดสั้นที่ต้องการคุมถ้อยคำเอง', 'เกมละลายพฤติกรรมสำหรับห้องประชุม'],
      meta: 'ไม่ต้องมีไฟล์',
      state: editorState,
    },
  ];

  return (
    <div className="relative min-h-dvh px-4 pt-6 pb-20 sm:px-5">
      <FloatingShapes opacity={0.05} />
      <div className="relative mx-auto max-w-5xl">
        <SiteNav here="create" />

        <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-10 max-w-3xl">
          <p className="text-sm font-semibold tracking-wide text-brand-2">สร้างข้อสอบหรือเกมใหม่</p>
          <h1 className="mt-2 text-3xl font-extrabold text-balance sm:text-4xl">เริ่มจากเนื้อหาที่คุณมี</h1>
          <p className="mt-3 leading-relaxed text-pretty text-white/70">
            เลือกวิธีที่ตรงกับเนื้อหาของคุณ ทุกวิธีได้ชุดคำถามพร้อมเฉลยและคำอธิบาย ใช้เป็นข้อสอบให้ทำเองได้ทันที หรือเปิดห้องเล่นสดพร้อมกันทั้งทีม
          </p>
        </motion.div>

        {account.status === 'error' && (
          <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-white/85">
            <span className="min-w-0 flex-1">โหลดข้อมูลบัญชีไม่ได้ ตรวจว่าเครื่องนี้ต่อ Wi-Fi บริษัทหรือ VPN อยู่</span>
            <button type="button" onClick={() => void refreshAccount()} className="btn btn-light px-4 py-2 text-base">
              ลองใหม่
            </button>
          </div>
        )}
        {accounts && !user && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.06] p-4">
            <span className="min-w-0 flex-1 text-white/85">เข้าสู่ระบบเพื่อบันทึกชุดคำถามไว้ในบัญชีของคุณ และใช้ได้ทุกวิธี</span>
            <Link href={login('/create')} className="btn btn-light px-4 py-2 text-base">
              เข้าสู่ระบบ
            </Link>
          </div>
        )}

        <ul className="mt-8 grid gap-4 md:grid-cols-2" aria-label="วิธีสร้างชุดคำถาม">
          {ways.map((w, i) => (
            <motion.li key={w.key} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.04 * (i + 1) }} className="min-w-0">
              <WayCard way={w} />
            </motion.li>
          ))}
        </ul>

        <section aria-label="ขั้นตอนหลังจากนี้" className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
          <h2 className="text-sm font-semibold tracking-wide text-white/60">ทุกวิธีจบที่เดียวกัน</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              ['เลือกวิธี', 'จากเอกสาร คลังความรู้ ไฟล์ หรือเขียนเอง'],
              ['ตรวจก่อนบันทึก', 'อ่านทุกข้อ ตัดหรือแก้ข้อที่ไม่ใช่ แล้วบันทึกเข้าเกมของฉัน'],
              ['ใช้งาน', 'ส่งลิงก์ข้อสอบให้ทำเอง หรือเปิดห้องเล่นสดบนจอใหญ่'],
            ].map(([head, text], i) => (
              <li key={head} className="flex min-w-0 gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-white">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-white">{head}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-white/60">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

interface Way {
  key: string;
  icon: React.ReactNode;
  tone: keyof typeof TONES;
  title: string;
  text: string;
  fits: string[];
  meta: string;
  state:
    | { kind: 'loading' }
    | { kind: 'go'; href: string; label: string; note?: string }
    | { kind: 'login'; href: string }
    | { kind: 'off'; title: string; text: string; badge?: string };
}

const TONES = {
  violet: 'bg-brand/20 text-[#a5b4ff] ring-brand/40',
  cyan: 'bg-brand-2/10 text-brand-2 ring-brand-2/30',
  green: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30',
  amber: 'bg-gold/10 text-gold ring-gold/30',
};

function WayCard({ way }: { way: Way }) {
  const { state } = way;
  const open = state.kind === 'go' || state.kind === 'login';
  return (
    <article
      data-testid={`create-${way.key}`}
      data-state={state.kind}
      className={`relative flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-white shadow-[0_12px_32px_-16px_rgb(0_0_0/0.6)] backdrop-blur-sm transition-colors sm:p-6 ${
        open ? 'focus-within:border-brand-2/70 hover:border-white/25 hover:bg-white/[0.08]' : ''
      }`}
    >
      <div className="flex items-center gap-4">
        <span className={`grid size-12 shrink-0 place-items-center rounded-xl ring-1 ${TONES[way.tone]} ${state.kind === 'off' ? 'opacity-50 grayscale' : ''}`}>{way.icon}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold">{way.title}</h2>
          <Badge state={state} />
        </div>
      </div>
      <p className="mt-3 leading-relaxed text-pretty text-white/70 sm:pl-16">{way.text}</p>

      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-xs font-semibold tracking-wide text-white/55">เหมาะกับ</p>
        <ul className="mt-2 grid gap-1.5">
          {way.fits.map((f) => (
            <li key={f} className="flex gap-2 text-[15px] text-white/85">
              <svg viewBox="0 0 16 16" className="mt-1 size-4 shrink-0 text-emerald-300" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
              <span className="min-w-0">{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-5">
        {state.kind === 'off' ? (
          <div className="flex gap-3 rounded-xl bg-black/20 p-3.5 ring-1 ring-white/10" data-testid={`create-${way.key}-why`}>
            <svg viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-white/55" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="10" cy="10" r="7.5" />
              <path d="M10 9v5M10 6.2v.1" strokeLinecap="round" />
            </svg>
            <p className="min-w-0 text-sm leading-relaxed text-white/70">
              <span className="block font-semibold text-white">{state.title}</span>
              {state.text}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-white/60">{state.kind === 'go' && state.note ? state.note : way.meta}</p>
            {state.kind === 'loading' ? (
              <span className="h-11 w-36 animate-pulse rounded-xl bg-white/10" aria-label="กำลังตรวจ" />
            ) : (
              <Link
                href={state.href}
                data-testid={`create-${way.key}-go`}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold transition-colors after:absolute after:inset-0 after:rounded-2xl after:content-[''] ${
                  state.kind === 'login' ? 'bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15' : 'bg-brand text-white shadow-[0_6px_20px_-6px_rgb(61_90_254/0.7)] hover:bg-[#5873ff]'
                }`}
              >
                {state.kind === 'login' ? 'เข้าสู่ระบบเพื่อใช้' : state.label}
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10m-4-4 4 4-4 4" />
                </svg>
              </Link>
            )}
          </div>
        )}
        {state.kind === 'go' && state.note && <p className="mt-2 text-xs text-white/50">{way.meta}</p>}
      </div>
    </article>
  );
}

function Badge({ state }: { state: Way['state'] }) {
  if (state.kind === 'loading') return null;
  const [text, cls] =
    state.kind === 'go'
      ? ['พร้อมใช้', 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30']
      : state.kind === 'login'
        ? ['ต้องเข้าสู่ระบบ', 'bg-gold/10 text-gold ring-gold/30']
        : [state.badge ?? 'ยังไม่เปิดใช้', 'bg-white/10 text-white/70 ring-white/15'];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ${cls}`}>{text}</span>;
}

const iconProps = { viewBox: '0 0 24 24', className: 'size-6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function SparkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3.5 13.9 9a1.6 1.6 0 0 0 1 1l5.6 2-5.6 2a1.6 1.6 0 0 0-1 1L12 20.5 10.1 15a1.6 1.6 0 0 0-1-1L3.5 12l5.6-2a1.6 1.6 0 0 0 1-1Z" />
      <path d="M19 3v3M17.5 4.5h3" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
      <path d="M9 4h4v16H9" />
      <path d="m15.2 5.1 3.3-.9a1 1 0 0 1 1.2.7l3.1 11.7a1 1 0 0 1-.7 1.2l-3.3.9" transform="translate(-2.4 .6)" />
    </svg>
  );
}

function SheetIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M3.5 14.5h17M9.5 4v16" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg {...iconProps}>
      <path d="M14.5 5.5 18.5 9.5" />
      <path d="M4 20l1-4.2L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19Z" />
    </svg>
  );
}
