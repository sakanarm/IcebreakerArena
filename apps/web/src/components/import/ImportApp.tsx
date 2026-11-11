'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LIMITS, SHEET_TEMPLATE, parseCsv, readSheets, sheetGames, type Game, type SheetIn, type SheetRead } from '@pika-arena/shared';
import { refreshAccount, useAccount, type AccountUser } from '@/lib/account';
import { quizStatus, type QuizPaper, type QuizStatus } from '@/lib/ai-quiz';
import { apiMessage } from '@/lib/api';
import { cloud } from '@/lib/cloud';
import { downloadText, toCsv } from '@/lib/csv';
import { newId, saveMyGame } from '@/lib/games';
import { SHEET_ACCEPT, readSheetFile } from '@/lib/sheet-file';
import { SiteNav } from '../SiteNav';
import { AI_FORM, AiPick, type AiForm } from './AiPick';
import { WaitingDots } from '../motion-bits';
import { Notice } from '../Notice';
import { FloatingShapes } from '../shapes';

/** what was read, and from where: the title starts as the file's name */
interface Loaded {
  source: string;
  read: SheetRead;
  /** set when the AI wrote the questions: the maker checks each one before saving */
  ai?: { quotes: Record<string, string> };
}

type Tab = 'file' | 'paste' | 'ai';

interface Made {
  id: string;
  title: string;
  count: number;
}

const DRAW_CHOICES = [5, 10, 15, 20, 30];
const LETTERS = 'กขคง';

/** Turns an Excel or CSV question bank into games: pick the file, check what was read, save. */
export function ImportApp() {
  const account = useAccount();
  if (account.status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center text-xl">
        <span className="flex items-center gap-3">
          กำลังเปิด <WaitingDots />
        </span>
      </div>
    );
  }
  if (account.status === 'error') {
    return (
      <Notice
        emoji="📡"
        title="เชื่อมต่อไม่ได้"
        actions={
          <button type="button" onClick={() => void refreshAccount()} className="btn btn-primary">
            ลองใหม่
          </button>
        }
      >
        ตรวจว่าเครื่องนี้ต่อ Wi-Fi บริษัทหรือ VPN อยู่ แล้วลองใหม่
      </Notice>
    );
  }
  if (account.mode !== 'off' && !account.user) {
    return (
      <Notice
        emoji="🔑"
        title="เข้าสู่ระบบก่อนนำเข้าคลังข้อสอบ"
        actions={
          <>
            <Link href={`/login?next=${encodeURIComponent('/import')}`} className="btn btn-primary">
              เข้าสู่ระบบ
            </Link>
            <Link href="/host" className="btn btn-ghost">
              กลับ
            </Link>
          </>
        }
      >
        คำถามที่นำเข้าจะเป็นเกมในบัญชีของคุณ ใช้เล่นสดหรือเปิดเป็นข้อสอบก็ได้
      </Notice>
    );
  }
  const user = account.mode === 'off' ? null : account.user;
  return <Importer key={user?.id ?? 'browser'} user={user} />;
}

function Importer({ user }: { user: AccountUser | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [made, setMade] = useState<Made[] | null>(null);
  // kept here, not in the tab, so going back from the preview finds the form as it was
  const [tab, setTab] = useState<Tab>('file');
  const [aiForm, setAiForm] = useState<AiForm>(AI_FORM);
  const [ai, setAi] = useState<QuizStatus>({ enabled: false });

  useEffect(() => {
    let live = true;
    void quizStatus().then((s) => {
      if (!live) return;
      setAi(s);
      // the "ให้ AI ออกข้อสอบ" button on the games page opens this tab
      if (s.enabled && !s.needsLogin && new URLSearchParams(window.location.search).get('ai') === '1') setTab('ai');
    });
    return () => {
      live = false;
    };
  }, []);

  const aiReady = ai.enabled && !ai.needsLogin ? ai : null;

  const written = (paper: QuizPaper, asked: number) => {
    const notes: string[] = [];
    if (paper.dropped > 0) notes.push(`ตัดข้อที่ AI เขียนไม่ครบหรือผิดรูปแบบออก ${paper.dropped} ข้อ`);
    if (paper.count < asked) notes.push(`ได้ ${paper.count} จาก ${asked} ข้อที่ขอ เนื้อหาอาจมีข้อเท็จจริงไม่พอสำหรับข้อที่ไม่ซ้ำกัน`);
    setLoaded({
      source: paper.title || aiForm.name,
      read: { rounds: paper.rounds, count: paper.count, problems: [], notes },
      ai: { quotes: paper.quotes },
    });
  };

  return (
    <div className="relative min-h-dvh px-4 pt-6 pb-16 sm:px-5">
      <FloatingShapes opacity={0.06} />
      <div className="relative mx-auto max-w-4xl">
        <SiteNav here="create" />
        <Link href="/create" className="mt-6 inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-white/60 hover:text-white">
          ← วิธีสร้างอื่น
        </Link>

        <div className="mt-8">
          <h1 className="text-3xl font-extrabold text-balance sm:text-4xl">นำเข้าคลังข้อสอบ</h1>
          <p className="mt-2 max-w-2xl text-white/70">
            มีข้อสอบอยู่ใน Excel หรือ Google Sheets อยู่แล้ว นำเข้ามาเป็นเกมได้ในครั้งเดียว
            {aiReady ? ' หรือให้ AI ออกข้อสอบจากเอกสารของคุณ' : ''} ใช้ทำข้อสอบสี่ตัวเลือก หรือเปิดห้องเล่นสดก็ได้
          </p>
        </div>

        <AnimatePresence mode="wait">
          {made ? (
            <Done key="done" made={made} inCloud={user !== null} byAi={!!loaded?.ai} onAgain={() => (setMade(null), setLoaded(null))} />
          ) : loaded ? (
            <Preview key="preview" loaded={loaded} inCloud={user !== null} onBack={() => setLoaded(null)} onMade={setMade} />
          ) : (
            <Pick
              key="pick"
              tab={tab === 'ai' && !aiReady ? 'file' : tab}
              onTab={setTab}
              onLoaded={setLoaded}
              ai={
                aiReady && (
                  <AiPick
                    form={aiForm}
                    onForm={setAiForm}
                    left={aiReady.left}
                    perDay={aiReady.perDay}
                    onWritten={written}
                    onLeft={(left) => setAi({ ...aiReady, left })}
                  />
                )
              }
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const step = {
  initial: { y: 16, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -10, opacity: 0 },
  transition: { duration: 0.2 },
};

// ---------- 1. pick a file or paste ----------

function Pick({ tab, onTab, onLoaded, ai }: { tab: Tab; onTab: (t: Tab) => void; onLoaded: (l: Loaded) => void; ai: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const open = async (file: File) => {
    setError(null);
    setBusy(true);
    const res = await readSheetFile(file);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onLoaded({ source: file.name.replace(/\.[^.]+$/, ''), read: readSheets(res.sheets) });
  };

  const usePaste = () => {
    setError(null);
    const sheets: SheetIn[] = [{ name: 'ที่วางมา', rows: parseCsv(paste) }];
    const read = readSheets(sheets);
    if (read.count === 0 && read.problems.length === 0) {
      return setError('ไม่พบหัวตาราง: คัดลอกให้ติดแถวหัวตาราง (คำถาม, ก, ข, ค, ง, คำตอบ) มาด้วย');
    }
    onLoaded({ source: '', read });
  };

  const tabs: [Tab, string][] = [
    ['file', '📄 อัปโหลดไฟล์'],
    ['paste', '📋 วางจากตาราง'],
  ];
  if (ai) tabs.push(['ai', '✨ ให้ AI ออกข้อสอบ']);

  return (
    <motion.section {...step} className="mt-8 grid grid-cols-1 gap-5">
      <div className="glass p-4 sm:p-6">
        <div role="tablist" aria-label="วิธีนำเข้า" className="mb-5 inline-flex max-w-full flex-wrap rounded-2xl bg-black/25 p-1">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => (onTab(key), setError(null))}
              className={`rounded-xl px-4 py-2 font-semibold transition ${tab === key ? 'bg-white text-ink shadow' : 'text-white/75 hover:text-white'}`}
              data-testid={`import-tab-${key}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'ai' && ai ? (
          ai
        ) : tab === 'file' ? (
          <div
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void open(file);
            }}
            className={`grid place-items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${over ? 'border-gold bg-gold/10' : 'border-white/25 bg-black/15'}`}
          >
            <span className="text-5xl" aria-hidden>
              📊
            </span>
            <p className="text-lg font-semibold">ลากไฟล์มาวางที่นี่ หรือ</p>
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn btn-gold">
              {busy ? (
                <>
                  กำลังอ่าน <WaitingDots />
                </>
              ) : (
                'เลือกไฟล์ Excel หรือ CSV'
              )}
            </button>
            <p className="text-sm text-white/55">.xlsx หรือ .csv ไม่เกิน 5 MB · ไฟล์อ่านบนเครื่องนี้ ไม่ได้ส่งไปไหนจนกว่าจะกดนำเข้า</p>
            <input
              ref={input}
              type="file"
              accept={SHEET_ACCEPT}
              className="hidden"
              data-testid="sheet-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void open(file);
              }}
            />
          </div>
        ) : (
          <div className="grid gap-3">
            <label htmlFor="paste" className="text-white/80">
              เลือกช่องใน Excel หรือ Google Sheets ตั้งแต่แถวหัวตาราง กดคัดลอก แล้ววางที่นี่
            </label>
            <textarea
              id="paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'คำถาม\tก\tข\tค\tง\tคำตอบ\n…'}
              className="field font-mono text-sm whitespace-pre"
            />
            <div>
              <button type="button" disabled={!paste.trim()} onClick={usePaste} className="btn btn-gold">
                อ่านตาราง
              </button>
            </div>
          </div>
        )}

        {error && tab !== 'ai' && (
          <p role="alert" className="mt-4 rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100">
            {error}
          </p>
        )}
      </div>

      {tab !== 'ai' && <Format />}
    </motion.section>
  );
}

/** how the sheet should look, with the template one click away */
function Format() {
  const template = () => downloadText('pika-arena-question-bank.csv', toCsv(SHEET_TEMPLATE));
  const [head, ...rows] = SHEET_TEMPLATE;
  return (
    <div className="glass p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">หน้าตาตารางที่อ่านได้</h2>
        <button type="button" onClick={template} className="btn btn-ghost px-4 text-base">
          ⬇️ ดาวน์โหลดแม่แบบ
        </button>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl bg-white text-ink">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                {r.map((c, j) => (
                  <td key={j} className={`px-3 py-2 ${j === 6 ? 'font-bold text-emerald-700' : ''} ${j === 7 ? 'text-slate-500' : ''}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 grid gap-2 text-sm text-white/75 sm:grid-cols-2">
        <li>
          <b className="text-white">คำตอบ</b> ใส่ ก ข ค ง (หรือ A B C D, 1 2 3 4) หรือพิมพ์ให้ตรงกับตัวเลือก ถูกหลายข้อคั่นด้วยจุลภาค เช่น “ก, ค”
        </li>
        <li>
          <b className="text-white">จริง/เท็จ</b> ใส่ตัวเลือกแค่ “จริง” กับ “เท็จ” (หรือ ถูก/ผิด) จะเป็นข้อแบบถูกผิดให้เอง
        </li>
        <li>
          <b className="text-white">หัวข้อ</b> ข้อที่หัวข้อเดียวกันอยู่ด่านเดียวกัน ช่องว่างใช้หัวข้อของแถวบน ไม่มีคอลัมน์นี้ก็ได้
        </li>
        <li>
          <b className="text-white">ไม่บังคับ</b> คำอธิบาย (ขึ้นตอนเฉลย), รูป (ลิงก์ https), เวลา (วินาที) · คำถามยาวไม่เกิน {LIMITS.promptMax} ตัวอักษร ตัวเลือกไม่เกิน{' '}
          {LIMITS.optionMax}
        </li>
      </ul>
    </div>
  );
}

// ---------- 2. check what was read ----------

function Preview({ loaded, inCloud, onBack, onMade }: { loaded: Loaded; inCloud: boolean; onBack: () => void; onMade: (m: Made[]) => void }) {
  const { ai } = loaded;
  // questions the maker has left out (AI papers only): everything below counts and saves without them
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const read = useMemo<SheetRead>(() => {
    if (left.size === 0) return loaded.read;
    const rounds = loaded.read.rounds.map((r) => ({ ...r, questions: r.questions.filter((q) => !left.has(q.id)) })).filter((r) => r.questions.length > 0);
    return { ...loaded.read, rounds, count: rounds.reduce((n, r) => n + r.questions.length, 0) };
  }, [loaded.read, left]);
  const toggle = (id: string) =>
    setLeft((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const backLabel = ai ? 'กลับไปแก้เนื้อหา' : 'เลือกไฟล์อื่น';
  const [title, setTitle] = useState(loaded.source.slice(0, LIMITS.titleMax - 16));
  const [bank, setBank] = useState(false);
  const [draw, setDraw] = useState(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const parts = Math.ceil(read.count / LIMITS.questionsMax);
  const bigRounds = read.rounds.filter((r) => r.questions.length > draw).length;
  const problems = read.problems;
  const shownProblems = showAll ? problems : problems.slice(0, 8);

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError('ตั้งชื่อคลังข้อสอบก่อน');
    const res = sheetGames(read.rounds, { title, ...(bank ? { draw } : {}) });
    if (!res.ok) return setError(res.errors.slice(0, 3).join(' · '));
    setSaving(true);
    const done: Made[] = [];
    try {
      for (const game of res.games) {
        const count = game.rounds.reduce((n, r) => n + r.questions.length, 0);
        if (!inCloud) {
          const local: Game = { ...game, id: newId('g') };
          saveMyGame(local);
          done.push({ id: local.id, title: local.title, count });
        } else {
          const rec = await cloud.create(game, { from: 'import' });
          done.push({ id: rec.id, title: game.title, count });
        }
      }
      onMade(done);
    } catch (e) {
      setSaving(false);
      // the parts already saved stay saved: say so rather than leave them unexplained
      const saved = done.length ? ` (บันทึกไปแล้ว ${done.length} ชุด อยู่ในหน้าเกมของฉัน)` : '';
      setError(`${apiMessage(e)}${saved}`);
    }
  };

  return (
    <motion.section {...step} className="mt-8 grid grid-cols-1 gap-5">
      <div className="glass p-4 sm:p-6">
        {ai && (
          <div className="mb-4 flex gap-3 rounded-2xl bg-gold/15 px-4 py-3 text-amber-50" data-testid="ai-review">
            <span className="text-2xl" aria-hidden>
              🤖
            </span>
            <p className="min-w-0">
              <b>AI ออกข้อสอบให้แล้ว ตรวจทุกข้อก่อนบันทึก</b>
              <span className="block text-sm text-amber-50/80">
                ดูว่าเฉลยตรงกับเนื้อหาจริง (มีข้อความจากเนื้อหาแนบไว้ทุกข้อ) ข้อไหนไม่ดีให้เอาเครื่องหมายออก หรือบันทึกแล้วแก้ต่อใน Editor
              </span>
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2" data-testid="import-summary">
          <Stat tone="good" value={read.count} label={ai ? 'ข้อที่จะบันทึก' : 'ข้อที่นำเข้าได้'} />
          <Stat value={read.rounds.length} label="หัวข้อ" />
          {ai && left.size > 0 && <Stat value={left.size} label="ข้อที่เอาออก" />}
          {problems.length > 0 && <Stat tone="bad" value={problems.length} label="แถวที่ต้องแก้" />}
        </div>

        {read.notes.length > 0 && (
          <ul className="mt-4 grid gap-1 text-sm text-white/70">
            {read.notes.map((n) => (
              <li key={n}>ℹ️ {n}</li>
            ))}
          </ul>
        )}

        {problems.length > 0 && (
          <div className="mt-5 rounded-2xl bg-rose-500/15 p-4">
            <p className="font-semibold text-rose-100">
              {read.count > 0 ? 'แถวเหล่านี้จะถูกข้ามไป แก้ในไฟล์แล้วนำเข้าใหม่ หรือนำเข้าเฉพาะข้อที่ถูกต้องก่อนก็ได้' : 'ยังไม่มีแถวที่นำเข้าได้ แก้ในไฟล์ตามนี้แล้วลองใหม่'}
            </p>
            <ul className="mt-3 grid gap-1.5 text-sm" data-testid="import-problems">
              {shownProblems.map((p, i) => (
                <li key={i} className="flex flex-col items-start gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 rounded-md bg-black/30 px-2 font-mono text-xs leading-6 text-rose-100">
                    {p.sheet ? `${p.sheet} · ` : ''}แถว {p.row}
                  </span>
                  <span className="min-w-0 text-white/85">{p.message}</span>
                </li>
              ))}
            </ul>
            {problems.length > shownProblems.length && (
              <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-sm font-semibold text-rose-100 underline">
                ดูทั้งหมด {problems.length} แถว
              </button>
            )}
          </div>
        )}
      </div>

      {(read.count > 0 || ai) && (
        <>
          <div className="glass grid gap-4 p-4 sm:p-6">
            <label className="grid gap-2">
              <span className="font-semibold">ชื่อคลังข้อสอบ</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={LIMITS.titleMax - 16}
                placeholder="เช่น ข้อสอบ IT Security 2569"
                className="field text-lg"
                data-testid="import-title"
              />
            </label>
            {!ai && (
              <>
                <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <input type="checkbox" checked={bank} onChange={(e) => setBank(e.target.checked)} className="size-5 accent-[var(--color-gold)]" />
                  <span>เวลาเปิดห้องเล่นสด สุ่มถามหัวข้อละ</span>
                  <select value={draw} onChange={(e) => setDraw(Number(e.target.value))} disabled={!bank} className="rounded-lg bg-white px-2 py-1 text-ink disabled:opacity-50" aria-label="จำนวนข้อที่สุ่มต่อหัวข้อ">
                    {DRAW_CHOICES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span>ข้อ</span>
                </label>
                <p className="-mt-2 text-sm text-white/60">
                  {bank
                    ? bigRounds > 0
                      ? `หัวข้อที่มีมากกว่า ${draw} ข้อ (${bigRounds} หัวข้อ) จะสุ่มมาถามทีละ ${draw} ข้อ เล่นรอบใหม่ได้ชุดใหม่ ส่วนโหมดข้อสอบเลือกจำนวนข้อเองตอนเริ่มทำ`
                      : `ทุกหัวข้อมีไม่เกิน ${draw} ข้อ จึงถามครบทุกข้อเหมือนเดิม`
                    : 'ไม่เลือก: เล่นสดถามครบทุกข้อตามลำดับ ส่วนโหมดข้อสอบเลือกจำนวนข้อและสุ่มเองตอนเริ่มทำอยู่แล้ว'}
                </p>
              </>
            )}
            {parts > 1 && (
              <p className="rounded-xl bg-gold/15 px-4 py-3 text-sm text-amber-100">
                เกม 1 เกมมีได้ {LIMITS.questionsMax} ข้อ คลังนี้มี {read.count} ข้อ จึงแบ่งเป็น {parts} ชุด ชื่อ “{title.trim() || '…'} (ชุดที่ 1/{parts})” ไปเรื่อย ๆ
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => void save()} disabled={saving || read.count === 0} className="btn btn-gold" data-testid="import-save">
                {saving ? (
                  <>
                    กำลังบันทึก <WaitingDots />
                  </>
                ) : ai ? (
                  read.count === 0 ? 'เลือกอย่างน้อย 1 ข้อ' : `บันทึก ${read.count} ข้อเป็นเกม`
                ) : problems.length > 0 ? (
                  `นำเข้าเฉพาะ ${read.count} ข้อที่ถูกต้อง`
                ) : (
                  `นำเข้า ${read.count} ข้อ`
                )}
              </button>
              <button type="button" onClick={onBack} disabled={saving} className="btn btn-ghost">
                {backLabel}
              </button>
            </div>
          </div>

          {ai ? <Questions read={loaded.read} quotes={ai.quotes} left={left} onToggle={saving ? undefined : toggle} /> : <Questions read={read} />}
        </>
      )}

      {read.count === 0 && !ai && (
        <div>
          <button type="button" onClick={onBack} className="btn btn-gold">
            {backLabel}
          </button>
        </div>
      )}
    </motion.section>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'bg-emerald-400/20 text-emerald-100' : tone === 'bad' ? 'bg-rose-500/20 text-rose-100' : 'bg-white/10 text-white';
  return (
    <span className={`inline-flex items-baseline gap-2 rounded-2xl px-4 py-2 ${color}`}>
      <b className="font-display text-2xl">{value.toLocaleString('th-TH')}</b>
      <span className="text-sm">{label}</span>
    </span>
  );
}

/** every question as it will be saved, answer marked, so a misread column shows before saving */
function Questions({
  read,
  quotes,
  left,
  onToggle,
}: {
  read: SheetRead;
  /** AI papers: the document's words behind each question, and the ones the maker left out */
  quotes?: Record<string, string>;
  left?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
}) {
  const review = quotes !== undefined;
  // an AI paper is short and every question needs a look, so all of it starts open
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(review || read.rounds.length === 1 ? read.rounds.map((_, i) => i) : []));
  const flip = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  return (
    <div className="glass p-2 sm:p-3" data-testid="import-rounds">
      <h2 className="px-3 pt-2 pb-1 text-lg font-bold">{review ? 'ตรวจคำถามที่ AI ออก' : 'ตรวจคำถามก่อนนำเข้า'}</h2>
      {read.rounds.map((r, ri) => (
        <div key={r.id} className="border-t border-white/10 first-of-type:border-0">
          <button
            type="button"
            onClick={() => flip(ri)}
            aria-expanded={open.has(ri)}
            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5"
          >
            <span className="min-w-0 font-semibold break-words">{r.title}</span>
            <span className="shrink-0 text-sm text-white/60">
              {r.questions.length} ข้อ {open.has(ri) ? '▴' : '▾'}
            </span>
          </button>
          {open.has(ri) && (
            <ol className="grid gap-2 px-2 pb-3">
              {r.questions.map((q, qi) => {
                const out = left?.has(q.id) ?? false;
                return (
                  <li key={q.id} className={`card p-4 transition ${out ? 'opacity-45' : ''}`} data-testid="import-question">
                    <div className="flex items-start gap-3">
                      {review && (
                        <input
                          type="checkbox"
                          checked={!out}
                          disabled={!onToggle}
                          onChange={() => onToggle?.(q.id)}
                          className="mt-1 size-5 shrink-0 accent-emerald-600"
                          aria-label={`ใช้ข้อ ${qi + 1} ของ ${r.title}`}
                          data-testid="import-keep"
                        />
                      )}
                      <p className={`min-w-0 font-semibold break-words ${out ? 'line-through' : ''}`}>
                        <span className="mr-1 text-slate-400">{qi + 1}.</span>
                        {q.prompt}
                        {q.type === 'truefalse' && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">ถูก/ผิด</span>}
                      </p>
                    </div>
                    <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                      {q.options.map((o, oi) => {
                        const right = q.correct.includes(oi);
                        return (
                          <li key={oi} className={`flex gap-2 rounded-lg px-2 py-1 break-words ${right ? 'bg-emerald-50 font-semibold text-emerald-800' : 'text-slate-600'}`}>
                            <span className="shrink-0">{right ? '✓' : `${LETTERS[oi]}.`}</span>
                            <span className="min-w-0">{o}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {q.explanation && <p className="mt-2 text-sm whitespace-pre-line text-slate-500 break-words">💡 {q.explanation}</p>}
                    {quotes?.[q.id] && (
                      <blockquote className="mt-2 border-l-4 border-sky-300 bg-sky-50 px-3 py-1.5 text-sm text-slate-600 break-words" data-testid="import-quote">
                        📄 จากเนื้อหา: “{quotes[q.id]}”
                      </blockquote>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- 3. done ----------

function Done({ made, inCloud, byAi, onAgain }: { made: Made[]; inCloud: boolean; byAi: boolean; onAgain: () => void }) {
  const total = made.reduce((n, m) => n + m.count, 0);
  return (
    <motion.section {...step} className="mt-8 grid gap-5" data-testid="import-done">
      <div className="glass p-5 text-center sm:p-8">
        <div className="text-6xl" aria-hidden>
          🎉
        </div>
        <h2 className="mt-3 text-2xl font-extrabold text-balance">
          {byAi ? 'บันทึก' : 'นำเข้า'}แล้ว {total.toLocaleString('th-TH')} ข้อ
        </h2>
        <p className="mt-2 text-white/70">
          {inCloud ? 'เก็บไว้ในบัญชีของคุณแล้ว' : 'เก็บไว้ในเบราว์เซอร์นี้แล้ว'} ทำข้อสอบได้ทันที หรือเปิดใน Editor เพื่อแก้ เพิ่มรูป แล้วเปิดห้องเล่นสด
        </p>
      </div>
      <ul className="grid gap-3">
        {made.map((m) => (
          <li key={m.id} className="glass flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold break-words">{m.title}</p>
              <p className="text-sm text-white/60">{m.count} ข้อ</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/exam/${m.id}`} className="btn btn-gold px-4 text-base">
                📝 ทำข้อสอบ
              </Link>
              <Link href={`/editor?id=${m.id}`} className="btn btn-ghost px-4 text-base">
                ✏️ แก้ใน Editor
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Link href="/host" className="btn btn-primary">
          ไปที่เกมของฉัน
        </Link>
        <button type="button" onClick={onAgain} className="btn btn-ghost">
          {byAi ? 'ให้ AI ออกอีกชุด' : 'นำเข้าไฟล์อื่น'}
        </button>
      </div>
    </motion.section>
  );
}
