'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS, MAX_PAGES, buildQuestions, hasContactInfo, type FactPlan, type Question, type QuestionType } from '@pika-arena/shared';
import { refreshAccount, useAccount, type AccountUser } from '@/lib/account';
import { ApiError, api, apiMessage, apiUpload, errorCode } from '@/lib/api';
import { AccountChip } from '../AccountChip';
import { WaitingDots } from '../motion-bits';
import { Notice } from '../Notice';
import { FloatingShapes, Logo } from '../shapes';

// ---------- what the API answers ----------

interface ProjectState {
  configured: boolean;
  hasEmail: boolean;
  projectId: string | null;
}

interface Doc {
  documentId: string;
  title: string;
  sourceRef: string | null;
  docDate: string | null;
  ingestedDate: string | null;
  bytes: number | null;
  pages: string[];
}

interface Hit {
  path: string;
  title: string;
  snippet: string;
}

interface Job {
  id: string;
  state: 'running' | 'done' | 'failed';
  pages: string[];
  documentId: string | null;
}

interface Fact {
  id: string;
  page: string;
  pageTitle: string | null;
  cite: string | null;
  text: string;
  type: QuestionType;
}

interface Facts {
  pages: { path: string; title: string; summary: string; kept: number }[];
  missing: string[];
  facts: Fact[];
  dropped: { page: string; text: string | null; why: string; reason: string }[];
}

interface Made {
  id: string;
  title: string;
  count: number;
}

/** what the server takes (server/pika.ts INGEST_TYPES, INGEST_MAX_BYTES, INGEST_TEXT_MAX) */
const FILE_TYPES = ['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv'];
const FILE_MAX_BYTES = 20 * 1024 * 1024;
const TEXT_MIN = 200;
const TEXT_MAX = 200_000;
/** Pika reads a document in about twenty seconds; past this something is wrong, and we stop asking */
const JOB_PATIENCE_MS = 15 * 60 * 1000;
const POLL_MS = 2500;
const LETTERS = 'กขคง';

/** a page's path as a name, when Pika has not told us its title: `topics/leave-policy.md` → leave policy */
const pageName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim() || path;

/** a fresh key for one send, so pressing twice (or a retry after a dropped answer) learns the file once */
function sendKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const step = {
  initial: { y: 16, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -10, opacity: 0 },
  transition: { duration: 0.2 },
};

/**
 * Makes a practice exam from the person's own knowledge base in Pika: add a document (or use what is
 * already there), choose up to ten pages, check every question it gives, save.
 */
export function PikaApp() {
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
  if (account.mode === 'off') {
    return (
      <Notice
        emoji="🔒"
        title="ใช้คลังความรู้ได้เมื่อมีบัญชี"
        actions={
          <Link href="/host" className="btn btn-ghost">
            กลับ
          </Link>
        }
      >
        คลังความรู้ Pika เป็นของแต่ละคน เครื่องนี้ยังไม่ได้เปิดระบบบัญชี จึงยังใช้ไม่ได้
      </Notice>
    );
  }
  if (!account.user) {
    return (
      <Notice
        emoji="🔑"
        title="เข้าสู่ระบบก่อนสร้างข้อสอบจากคลังความรู้"
        actions={
          <>
            <Link href={`/login?next=${encodeURIComponent('/pika')}`} className="btn btn-primary">
              เข้าสู่ระบบ
            </Link>
            <Link href="/host" className="btn btn-ghost">
              กลับ
            </Link>
          </>
        }
      >
        เอกสารที่เพิ่มเข้าไปอยู่ในคลังความรู้ส่วนตัวของคุณใน Pika คนอื่นมองไม่เห็น
      </Notice>
    );
  }
  return <Maker key={account.user.id} user={account.user} />;
}

function Maker({ user }: { user: AccountUser }) {
  const [project, setProject] = useState<ProjectState | 'loading' | { error: string }>('loading');
  const [facts, setFacts] = useState<Facts | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  // the pages chosen, kept here so going back from the review keeps them
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setProject('loading');
    try {
      setProject(await api<ProjectState>('/pika/project'));
    } catch (e) {
      setProject({ error: apiMessage(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-dvh px-4 pt-6 pb-28 sm:px-5">
      <FloatingShapes opacity={0.06} />
      <div className="relative mx-auto max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/host" aria-label="กลับไปที่เกมของฉัน">
            <Logo small />
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <AccountChip />
            <Link href="/host" className="btn btn-ghost px-4 text-base">
              ← เกมของฉัน
            </Link>
          </div>
        </header>

        <div className="mt-8">
          <h1 className="text-3xl font-extrabold text-balance sm:text-4xl">ข้อสอบจากคลังความรู้</h1>
          <p className="mt-2 max-w-2xl text-white/70">
            เพิ่มเอกสารการทำงาน คู่มือ หรือสไลด์อบรมเข้าคลังความรู้ Pika ของคุณ แล้วเลือกหน้าที่ต้องการมาตั้งเป็นข้อสอบสี่ตัวเลือก
            ทุกข้อมีเฉลยพร้อมข้อความต้นฉบับ
          </p>
        </div>

        {project === 'loading' ? (
          <p className="mt-10 flex items-center gap-3 text-lg text-white/80">
            กำลังเปิดคลังความรู้ <WaitingDots />
          </p>
        ) : 'error' in project ? (
          <Problem text={project.error} onRetry={() => void load()} />
        ) : !project.configured ? (
          <Blocked emoji="🛠️" title="ยังไม่ได้เชื่อมกับ Pika">
            เครื่องนี้ยังไม่ได้ตั้งค่าให้ต่อกับคลังความรู้ Pika ติดต่อผู้ดูแลระบบ
          </Blocked>
        ) : !project.hasEmail ? (
          <Blocked emoji="✉️" title="บัญชีนี้ยังไม่มีอีเมล">
            คลังความรู้ของแต่ละคนผูกกับอีเมลบริษัท ติดต่อผู้ดูแลระบบให้เพิ่มอีเมลให้บัญชี “{user.name}” ก่อน แล้วกลับมาที่หน้านี้
          </Blocked>
        ) : !project.projectId ? (
          <Start onMade={(projectId) => setProject({ ...project, projectId })} />
        ) : (
          <AnimatePresence mode="wait">
            {made ? (
              <Done key="done" made={made} onAgain={() => (setMade(null), setFacts(null), setChosen(new Map()))} />
            ) : facts ? (
              <Review key="review" facts={facts} onBack={() => setFacts(null)} onMade={setMade} />
            ) : (
              <Pick key="pick" chosen={chosen} setChosen={setChosen} onFacts={setFacts} />
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function Problem({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-500/20 px-4 py-3 text-rose-100">
      <span>{text}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-ghost px-4 text-base">
          ลองใหม่
        </button>
      )}
    </div>
  );
}

function Blocked({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="glass mt-8 p-6 text-center sm:p-10">
      <div className="text-5xl" aria-hidden>
        {emoji}
      </div>
      <h2 className="mt-3 text-2xl font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-white/70">{children}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/import" className="btn btn-ghost">
          📊 นำเข้าคลังข้อสอบจาก Excel แทน
        </Link>
      </div>
    </div>
  );
}

/** the first visit: the project is made once, on a press, so nobody gets one by just looking */
function Start({ onMade }: { onMade: (projectId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const { projectId } = await api<{ projectId: string }>('/pika/project', { method: 'POST' });
      onMade(projectId);
    } catch (e) {
      setError(apiMessage(e));
      setBusy(false);
    }
  };
  return (
    <motion.section {...step} className="glass mt-8 p-6 text-center sm:p-10">
      <div className="text-5xl" aria-hidden>
        📚
      </div>
      <h2 className="mt-3 text-2xl font-bold">เริ่มคลังความรู้ของคุณ</h2>
      <p className="mx-auto mt-2 max-w-lg text-white/70">
        สร้างโปรเจกต์ส่วนตัวใน Pika หนึ่งครั้ง เอกสารที่เพิ่มเข้าไปจะอยู่ในโปรเจกต์นี้เท่านั้น คนอื่นมองไม่เห็น
      </p>
      <button type="button" onClick={() => void make()} disabled={busy} className="btn btn-gold mt-5">
        {busy ? (
          <>
            กำลังสร้าง <WaitingDots />
          </>
        ) : (
          'สร้างคลังความรู้ของฉัน'
        )}
      </button>
      {error && (
        <p role="alert" className="mx-auto mt-4 max-w-lg rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100">
          {error}
        </p>
      )}
    </motion.section>
  );
}

// ---------- 1. add documents, choose pages ----------

interface Following {
  id: string;
  title: string;
  started: number;
  state: 'running' | 'done' | 'failed' | 'slow' | 'lost';
  pages: number;
  misses: number;
}

function Pick({
  chosen,
  setChosen,
  onFacts,
}: {
  chosen: Map<string, string>;
  setChosen: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  onFacts: (f: Facts) => void;
}) {
  const [docs, setDocs] = useState<{ list: Doc[]; total: number } | 'loading' | { error: string }>('loading');
  const [following, setFollowing] = useState<Following[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  const loadDocs = useCallback(async (quiet = false) => {
    if (!quiet) setDocs('loading');
    try {
      const r = await api<{ documents: Doc[]; total: number }>('/pika/documents');
      setDocs({ list: r.documents, total: r.total });
    } catch (e) {
      if (!quiet) setDocs({ error: apiMessage(e) });
    }
  }, []);
  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  /** choose (or let go of) several pages at once; what does not fit under the limit is left out, and said so */
  const setPages = (pages: [path: string, title: string][], on: boolean) => {
    const adding = on ? pages.filter(([p]) => !chosen.has(p)).length : 0;
    setFull(adding > MAX_PAGES - chosen.size);
    setChosen((m) => {
      const next = new Map(m);
      for (const [p, t] of pages) {
        if (!on) next.delete(p);
        else if (!next.has(p) && next.size < MAX_PAGES) next.set(p, t);
      }
      return next;
    });
  };
  const toggle = (path: string, title: string) => setPages([[path, title]], !chosen.has(path));

  // ask after each running document every few seconds; done ones choose their own pages
  const runningKey = following
    .filter((f) => f.state === 'running')
    .map((f) => f.id)
    .join('\n');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!runningKey) return;
    let live = true;
    const t = setTimeout(async () => {
      const ids = runningKey.split('\n');
      const answers = await Promise.all(
        ids.map((id) =>
          api<{ job: Job }>(`/pika/jobs/${encodeURIComponent(id)}`).then(
            (r) => ({ id, job: r.job, err: null as unknown }),
            (err: unknown) => ({ id, job: null, err }),
          ),
        ),
      );
      if (!live) return;
      setFollowing((list) =>
        list.map((f) => {
          const a = answers.find((x) => x.id === f.id);
          if (!a || f.state !== 'running') return f;
          if (a.job) {
            if (a.job.state === 'done') {
              return { ...f, state: 'done', pages: a.job.pages.length, misses: 0 };
            }
            if (a.job.state === 'failed') return { ...f, state: 'failed', misses: 0 };
            return Date.now() - f.started > JOB_PATIENCE_MS ? { ...f, state: 'slow' } : { ...f, misses: 0 };
          }
          // a job Pika no longer knows, or one we may not see, is not coming back
          if (a.err instanceof ApiError && (a.err.status === 404 || a.err.status === 400)) return { ...f, state: 'lost' };
          return f.misses >= 5 ? { ...f, state: 'lost' } : { ...f, misses: f.misses + 1 };
        }),
      );
      // the new pages are what the person most likely wants: choose them, as many as fit
      const fresh = answers.flatMap((a) => (a.job?.state === 'done' ? a.job.pages : []));
      if (fresh.length) {
        setChosen((m) => {
          const next = new Map(m);
          for (const p of fresh) if (next.size < MAX_PAGES && !next.has(p)) next.set(p, pageName(p));
          return next;
        });
        void loadDocs(true);
      }
      setTick((n) => n + 1);
    }, POLL_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [runningKey, tick, loadDocs, setChosen]);

  const read = async () => {
    setError(null);
    setReading(true);
    try {
      onFacts(await api<Facts>('/pika/facts', { method: 'POST', body: { paths: [...chosen.keys()], style: 'exam' } }));
    } catch (e) {
      setError(
        errorCode(e) === 'no_facts'
          ? 'หน้าที่เลือกยังไม่มีข้อความที่ตั้งเป็นข้อสอบได้ (ต้องมีหัวข้อ Details ที่เป็นข้อ ๆ) ลองเลือกหน้าอื่นเพิ่ม'
          : apiMessage(e),
      );
      setReading(false);
    }
  };

  return (
    <motion.section {...step} className="mt-8 grid gap-5">
      <Add onSent={(f) => setFollowing((l) => [f, ...l])} />

      {following.length > 0 && (
        <ul className="grid gap-2" aria-live="polite" data-testid="pika-jobs">
          {following.map((f) => (
            <li key={f.id} className="glass flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0 font-semibold break-words">{f.title}</span>
              <span className="text-sm text-white/75">
                {f.state === 'running' ? (
                  <span className="flex items-center gap-2">
                    Pika กำลังอ่าน <WaitingDots />
                  </span>
                ) : f.state === 'done' ? (
                  <span className="text-emerald-300">✓ อ่านแล้ว ได้ {f.pages} หน้า</span>
                ) : f.state === 'failed' ? (
                  <span className="text-rose-300">Pika อ่านเอกสารนี้ไม่สำเร็จ ลองไฟล์ PDF หรือวางเป็นข้อความแทน</span>
                ) : f.state === 'slow' ? (
                  <span className="text-amber-200">ยังอ่านไม่เสร็จ กลับมาดูในรายการเอกสารทีหลัง</span>
                ) : (
                  <span className="text-amber-200">ติดตามสถานะไม่ได้ ลองดูในรายการเอกสารด้านล่าง</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Library docs={docs} chosen={chosen} toggle={toggle} setPages={setPages} onReload={() => void loadDocs()} />

      <div className="glass sticky bottom-3 z-10 grid gap-3 p-4" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }} data-testid="pika-chosen">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold">
            เลือกแล้ว {chosen.size}/{MAX_PAGES} หน้า
            {full && <span className="ml-2 text-sm font-normal text-amber-200">ครบ {MAX_PAGES} หน้าแล้ว เอาบางหน้าออกก่อน</span>}
          </p>
          <button type="button" onClick={() => void read()} disabled={chosen.size === 0 || reading} className="btn btn-gold">
            {reading ? (
              <>
                กำลังอ่านหน้า <WaitingDots />
              </>
            ) : (
              'ตั้งข้อสอบจากหน้าที่เลือก →'
            )}
          </button>
        </div>
        {chosen.size > 0 && (
          <ul className="flex flex-wrap gap-2">
            {[...chosen].map(([path, title]) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => toggle(path, title)}
                  className="max-w-[16rem] truncate rounded-full bg-white/15 px-3 py-1 text-sm hover:bg-white/25"
                  title={`${path} (กดเพื่อเอาออก)`}
                  aria-label={`เอา ${title} ออก`}
                >
                  {title} ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100">
            {error}
          </p>
        )}
      </div>
    </motion.section>
  );
}

/** a file from this computer, or text pasted in: both go to the person's own project to be learned */
function Add({ onSent }: { onSent: (f: Following) => void }) {
  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // one key per thing being sent, kept across a retry of the same thing
  const pasteKey = useRef<string | null>(null);

  const send = async (file: File) => {
    setError(null);
    const dot = file.name.lastIndexOf('.');
    const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
    if (!FILE_TYPES.includes(ext)) return setError(apiMessage(new ApiError(415, 'file_type')));
    if (file.size === 0) return setError(apiMessage(new ApiError(400, 'empty_file')));
    if (file.size > FILE_MAX_BYTES) return setError(apiMessage(new ApiError(413, 'file_too_big')));
    const form = new FormData();
    form.set('file', file, file.name);
    form.set('title', file.name.slice(0, dot > 0 ? dot : undefined).slice(0, 200));
    form.set('key', sendKey());
    setBusy(true);
    try {
      const { job } = await apiUpload<{ job: Job }>('/pika/files', form);
      onSent({ id: job.id, title: file.name, started: Date.now(), state: job.state === 'done' ? 'running' : job.state, pages: 0, misses: 0 });
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendText = async () => {
    setError(null);
    const t = title.trim();
    const body = text.trim();
    if (!t) return setError(apiMessage(new ApiError(400, 'no_title')));
    if (body.length < TEXT_MIN) return setError(apiMessage(new ApiError(400, 'text_too_short')));
    if (body.length > TEXT_MAX) return setError(apiMessage(new ApiError(413, 'text_too_long')));
    pasteKey.current ??= sendKey();
    setBusy(true);
    try {
      const { job } = await api<{ job: Job }>('/pika/text', { method: 'POST', body: { title: t, content: body, key: pasteKey.current } });
      onSent({ id: job.id, title: t, started: Date.now(), state: job.state === 'done' ? 'running' : job.state, pages: 0, misses: 0 });
      pasteKey.current = null;
      setTitle('');
      setText('');
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const contact = useMemo(() => text.length >= TEXT_MIN && hasContactInfo(text), [text]);

  return (
    <div className="glass p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">เพิ่มเอกสารเข้าคลัง</h2>
        <div role="tablist" aria-label="วิธีเพิ่มเอกสาร" className="inline-flex rounded-2xl bg-black/25 p-1">
          {(
            [
              ['file', '📄 อัปโหลดไฟล์'],
              ['paste', '📋 วางข้อความ'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => (setTab(key), setError(null))}
              className={`rounded-xl px-4 py-2 font-semibold transition ${tab === key ? 'bg-white text-ink shadow' : 'text-white/75 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {tab === 'file' ? (
          <div
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const file = e.dataTransfer.files[0];
              if (file && !busy) void send(file);
            }}
            className={`grid place-items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${over ? 'border-gold bg-gold/10' : 'border-white/25 bg-black/15'}`}
          >
            <span className="text-4xl" aria-hidden>
              📚
            </span>
            <p className="text-lg font-semibold">ลากไฟล์มาวางที่นี่ หรือ</p>
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn btn-gold">
              {busy ? (
                <>
                  กำลังส่ง <WaitingDots />
                </>
              ) : (
                'เลือกไฟล์'
              )}
            </button>
            <p className="text-sm text-white/55">PDF, Word, PowerPoint, Excel, ข้อความ หรือ Markdown ไม่เกิน 20 MB · ส่งเข้าคลังความรู้ส่วนตัวของคุณใน Pika เท่านั้น</p>
            <input
              ref={input}
              type="file"
              accept={FILE_TYPES.join(',')}
              className="hidden"
              data-testid="pika-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void send(file);
              }}
            />
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-white/80">ชื่อเอกสาร</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="เช่น คู่มือพนักงานใหม่ 2026" className="field" />
            </label>
            <label className="grid gap-1">
              <span className="text-white/80">เนื้อหา</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={9}
                placeholder="วางเนื้อหาจากเอกสาร อีเมล หรือหน้าเว็บภายใน อย่างน้อย 200 ตัวอักษร"
                className="field text-base"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`text-sm ${text.trim().length > TEXT_MAX ? 'text-rose-300' : 'text-white/55'}`}>
                {text.trim().length.toLocaleString('th-TH')} ตัวอักษร
              </span>
              <button type="button" disabled={busy || !text.trim() || !title.trim()} onClick={() => void sendText()} className="btn btn-gold">
                {busy ? (
                  <>
                    กำลังส่ง <WaitingDots />
                  </>
                ) : (
                  'ส่งเข้าคลังความรู้'
                )}
              </button>
            </div>
            {contact && (
              <p className="rounded-xl bg-amber-400/15 px-4 py-3 text-sm text-amber-100">
                ข้อความนี้มีอีเมลหรือเบอร์โทร ข้อที่มีข้อมูลติดต่อจะไม่ถูกตั้งเป็นคำถาม ถ้าไม่จำเป็นลบออกก่อนส่งก็ได้
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** what is already in the project, by document, and a search across all of it */
function Library({
  docs,
  chosen,
  toggle,
  setPages,
  onReload,
}: {
  docs: { list: Doc[]; total: number } | 'loading' | { error: string };
  chosen: Map<string, string>;
  toggle: (path: string, title: string) => void;
  setPages: (pages: [path: string, title: string][], on: boolean) => void;
  onReload: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError(null);
    if (query.trim().length < 2) return setSearchError(apiMessage(new ApiError(400, 'bad_query')));
    setSearching(true);
    try {
      setHits((await api<{ hits: Hit[] }>('/pika/search', { method: 'POST', body: { query: query.trim() } })).hits);
    } catch (err) {
      setSearchError(apiMessage(err));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="glass p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">เลือกหน้าที่จะออกข้อสอบ</h2>
        <button type="button" onClick={onReload} className="btn btn-ghost px-3 text-sm">
          ↻ โหลดรายการใหม่
        </button>
      </div>
      <p className="mt-1 text-sm text-white/60">Pika แบ่งเอกสารแต่ละชิ้นเป็นหน้าตามหัวข้อ เลือกได้ครั้งละไม่เกิน {MAX_PAGES} หน้า</p>

      <form onSubmit={(e) => void search(e)} className="mt-4 flex flex-wrap gap-2" role="search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={200}
          placeholder="ค้นในคลังความรู้ เช่น วันลา, ขั้นตอนเบิกเงิน"
          aria-label="ค้นในคลังความรู้"
          className="field min-w-0 flex-1"
        />
        <button type="submit" disabled={searching} className="btn btn-primary px-5">
          {searching ? <WaitingDots /> : 'ค้นหา'}
        </button>
        {hits && (
          <button type="button" onClick={() => (setHits(null), setQuery(''))} className="btn btn-ghost px-4">
            ล้าง
          </button>
        )}
      </form>
      {searchError && (
        <p role="alert" className="mt-3 rounded-xl bg-rose-500/20 px-4 py-2 text-rose-100">
          {searchError}
        </p>
      )}

      {hits ? (
        hits.length === 0 ? (
          <p className="mt-4 text-white/70">ไม่พบหน้าที่ตรงกับคำค้น ลองคำอื่น</p>
        ) : (
          <ul className="mt-4 grid gap-2" data-testid="pika-hits">
            {hits.map((h) => (
              <li key={h.path}>
                <PageRow path={h.path} title={h.title || pageName(h.path)} note={h.snippet} on={chosen.has(h.path)} toggle={toggle} />
              </li>
            ))}
          </ul>
        )
      ) : docs === 'loading' ? (
        <p className="mt-5 flex items-center gap-3 text-white/75">
          กำลังโหลดเอกสาร <WaitingDots />
        </p>
      ) : 'error' in docs ? (
        <p role="alert" className="mt-4 rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100">
          {docs.error}
        </p>
      ) : docs.list.length === 0 ? (
        <p className="mt-5 rounded-xl bg-black/15 px-4 py-6 text-center text-white/70">ยังไม่มีเอกสารในคลัง เพิ่มไฟล์หรือวางข้อความด้านบนก่อน</p>
      ) : (
        <ul className="mt-4 grid gap-2" data-testid="pika-docs">
          {docs.list.map((d) => {
            const picked = d.pages.filter((p) => chosen.has(p)).length;
            const isOpen = open === d.documentId;
            return (
              <li key={d.documentId} className="rounded-2xl bg-black/15">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : d.documentId)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left hover:bg-white/5"
                >
                  <span className="min-w-0 font-semibold break-words">📄 {d.title || d.documentId}</span>
                  <span className="shrink-0 text-sm text-white/60">
                    {d.pages.length === 0 ? 'ยังไม่มีหน้า' : `${d.pages.length} หน้า`}
                    {picked > 0 && <span className="ml-2 text-gold">เลือก {picked}</span>}
                    {d.bytes ? ` · ${sizeText(d.bytes)}` : ''} {isOpen ? '▴' : '▾'}
                  </span>
                </button>
                {isOpen && (
                  <div className="grid gap-2 px-3 pb-3">
                    {d.pages.length === 0 ? (
                      <p className="px-1 text-sm text-white/60">Pika ยังอ่านเอกสารนี้ไม่เสร็จ หรือไม่ได้หน้าใดออกมา</p>
                    ) : (
                      <>
                        {d.pages.length > 1 && (
                          <button
                            type="button"
                            className="justify-self-start text-sm text-white/70 underline-offset-4 hover:underline"
                            onClick={() =>
                              setPages(
                                d.pages.map((p) => [p, pageName(p)]),
                                !d.pages.every((p) => chosen.has(p)),
                              )
                            }
                          >
                            {d.pages.every((p) => chosen.has(p)) ? 'ไม่เลือกทั้งเอกสาร' : 'เลือกทั้งเอกสาร'}
                          </button>
                        )}
                        {d.pages.map((p) => (
                          <PageRow key={p} path={p} title={pageName(p)} on={chosen.has(p)} toggle={toggle} />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {docs.total > docs.list.length && (
            <li className="px-2 text-sm text-white/60">แสดง {docs.list.length} จาก {docs.total} เอกสารล่าสุด ใช้ช่องค้นหาเพื่อหาหน้าในเอกสารที่เหลือ</li>
          )}
        </ul>
      )}
    </div>
  );
}

function PageRow({ path, title, note, on, toggle }: { path: string; title: string; note?: string; on: boolean; toggle: (path: string, title: string) => void }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 transition ${on ? 'bg-gold/15 ring-1 ring-gold/60' : 'bg-white/5 hover:bg-white/10'}`}>
      <input type="checkbox" checked={on} onChange={() => toggle(path, title)} className="mt-1 size-4 shrink-0 accent-gold" />
      <span className="min-w-0">
        <span className="block font-semibold break-words">{title}</span>
        {note && <span className="mt-0.5 line-clamp-2 block text-sm break-words text-white/60">{note}</span>}
        <span className="block truncate text-xs text-white/40">{path}</span>
      </span>
    </label>
  );
}

// ---------- 2. check every question ----------

const planOf = (f: Fact): FactPlan => ({
  text: f.text,
  page: f.page,
  type: f.type,
  ...(f.pageTitle ? { pageTitle: f.pageTitle } : {}),
  ...(f.cite ? { cite: f.cite } : {}),
});

function Review({ facts, onBack, onMade }: { facts: Facts; onBack: () => void; onMade: (m: Made) => void }) {
  // the first hundred are on to start with: one exam holds at most that many
  const [on, setOn] = useState<Set<string>>(() => new Set(facts.facts.slice(0, LIMITS.questionsMax).map((f) => f.id)));
  const [title, setTitle] = useState(() => (facts.pages.length === 1 ? facts.pages[0].title.slice(0, LIMITS.titleMax) : ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropped, setShowDropped] = useState(false);

  const plans = useMemo(() => facts.facts.filter((f) => on.has(f.id)).map((f) => ({ id: f.id, plan: planOf(f) })), [facts, on]);
  // built exactly as the server will build it, from the same facts in the same order
  const built = useMemo(() => {
    const { questions, facts: made } = buildQuestions(
      plans.map((p) => p.plan),
      { style: 'exam' },
    );
    const byFact = new Map<string, Question>();
    made.forEach((plan, i) => {
      const id = plans.find((p) => p.plan === plan)?.id;
      if (id) byFact.set(id, questions[i]);
    });
    return byFact;
  }, [plans]);
  const count = built.size;
  const over = on.size > LIMITS.questionsMax;

  const flip = (id: string) =>
    setOn((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setPage = (page: string, value: boolean) =>
    setOn((s) => {
      const next = new Set(s);
      for (const f of facts.facts) if (f.page === page) (value ? next.add(f.id) : next.delete(f.id));
      return next;
    });

  const save = async () => {
    setError(null);
    if (count === 0) return setError('เลือกอย่างน้อยหนึ่งข้อ');
    if (over) return setError(`ข้อสอบหนึ่งชุดมีได้ไม่เกิน ${LIMITS.questionsMax} ข้อ เอาออกบางข้อก่อน`);
    setSaving(true);
    try {
      const { game } = await api<{ game: { id: string; game: { title: string } } }>('/pika/draft', {
        method: 'POST',
        body: { style: 'exam', title: title.trim(), facts: plans.map((p) => p.plan) },
      });
      onMade({ id: game.id, title: game.game.title, count });
    } catch (e) {
      setError(apiMessage(e));
      setSaving(false);
    }
  };

  return (
    <motion.section {...step} className="mt-8 grid gap-5" data-testid="pika-review">
      <div className="glass grid gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onBack} className="btn btn-ghost px-4 text-base">
            ← เลือกหน้าใหม่
          </button>
          <div className="flex flex-wrap gap-2 text-sm">
            <Stat>{facts.pages.length} หน้า</Stat>
            <Stat>{count} ข้อ</Stat>
            {facts.dropped.length > 0 && <Stat>ไม่ได้ใช้ {facts.dropped.length}</Stat>}
          </div>
        </div>
        <label className="grid gap-1">
          <span className="font-semibold">ชื่อชุดข้อสอบ</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} placeholder="ข้อสอบจากคลังความรู้" className="field" />
        </label>
        <p className="text-sm text-white/65">
          🔒 ข้อสอบชุดนี้สร้างจากเอกสารภายในของคุณ ใช้ทำข้อสอบเองหรือเปิดห้องเล่นสดได้ แต่แชร์เข้าคลังกลางไม่ได้ · ตรวจทุกข้อก่อนบันทึก
          ข้อที่ไม่ต้องการกดเอาเครื่องหมายออก
        </p>
        {facts.missing.length > 0 && (
          <p className="rounded-xl bg-amber-400/15 px-4 py-3 text-sm text-amber-100">
            อ่านไม่ได้ {facts.missing.length} หน้า (อาจถูกลบไปแล้ว): {facts.missing.map(pageName).join(', ')}
          </p>
        )}
      </div>

      {facts.pages.map((page) => {
        const mine = facts.facts.filter((f) => f.page === page.path);
        if (mine.length === 0) return null;
        const allOn = mine.every((f) => on.has(f.id));
        return (
          <div key={page.path} className="glass p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2 px-1 pb-2">
              <div className="min-w-0">
                <h2 className="text-lg font-bold break-words">{page.title || pageName(page.path)}</h2>
                {page.summary && <p className="mt-0.5 line-clamp-2 text-sm text-white/60">{page.summary}</p>}
              </div>
              <button type="button" onClick={() => setPage(page.path, !allOn)} className="shrink-0 text-sm text-white/70 underline-offset-4 hover:underline">
                {allOn ? 'ไม่เลือกทั้งหน้า' : 'เลือกทั้งหน้า'}
              </button>
            </div>
            <ol className="grid gap-2">
              {mine.map((f) => (
                <li key={f.id}>
                  <FactCard fact={f} on={on.has(f.id)} question={built.get(f.id) ?? null} flip={() => flip(f.id)} />
                </li>
              ))}
            </ol>
          </div>
        );
      })}

      {facts.dropped.length > 0 && (
        <div className="glass p-4">
          <button type="button" onClick={() => setShowDropped((v) => !v)} aria-expanded={showDropped} className="flex w-full items-center justify-between gap-3 text-left">
            <span className="font-semibold">ข้อความที่ไม่ได้นำมาตั้งเป็นข้อสอบ ({facts.dropped.length})</span>
            <span className="text-white/60">{showDropped ? '▴' : '▾'}</span>
          </button>
          {showDropped && (
            <ul className="mt-3 grid gap-2 text-sm">
              {facts.dropped.map((d, i) => (
                <li key={i} className="rounded-xl bg-black/15 px-3 py-2">
                  <span className="text-white/80">{d.text ?? <i className="text-white/50">(ซ่อนข้อความไว้เพราะมีข้อมูลติดต่อ)</i>}</span>
                  <span className="mt-0.5 block text-xs text-white/50">
                    {pageName(d.page)} · {d.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="glass sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 p-4" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <p className="font-semibold">
          {count} ข้อ{over && <span className="ml-2 text-sm font-normal text-amber-200">เกิน {LIMITS.questionsMax} ข้อ เอาออกบางข้อก่อน</span>}
        </p>
        <button type="button" onClick={() => void save()} disabled={saving || count === 0 || over} className="btn btn-gold" data-testid="pika-save">
          {saving ? (
            <>
              กำลังบันทึก <WaitingDots />
            </>
          ) : (
            `📝 สร้างข้อสอบ ${count} ข้อ`
          )}
        </button>
        {error && (
          <p role="alert" className="w-full rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100">
            {error}
          </p>
        )}
      </div>
    </motion.section>
  );
}

function Stat({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-white/10 px-3 py-1 font-semibold">{children}</span>;
}

/** one fact: the question it becomes (answer marked), or the bare sentence when it is left out */
function FactCard({ fact, on, question, flip }: { fact: Fact; on: boolean; question: Question | null; flip: () => void }) {
  return (
    <div className={`flex gap-3 rounded-2xl p-3 sm:p-4 ${on ? 'bg-white text-ink' : 'bg-black/20 text-white/60'}`}>
      <input
        type="checkbox"
        checked={on}
        onChange={flip}
        aria-label={on ? 'ไม่ใช้ข้อนี้' : 'ใช้ข้อนี้'}
        className="mt-1 size-5 shrink-0 accent-emerald-600"
      />
      <div className="min-w-0 flex-1">
        {on && question ? (
          <>
            <p className="font-semibold break-words">
              {question.prompt}
              {question.type === 'truefalse' && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">ถูก/ผิด</span>}
            </p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {question.options.map((o, i) => {
                const right = question.correct.includes(i);
                return (
                  <li key={i} className={`flex gap-2 rounded-lg px-2 py-1 break-words ${right ? 'bg-emerald-50 font-semibold text-emerald-800' : 'text-slate-600'}`}>
                    <span className="shrink-0">{right ? '✓' : `${LETTERS[i] ?? i + 1}.`}</span>
                    <span className="min-w-0">{o}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs break-words text-slate-500">📖 {fact.text}</p>
          </>
        ) : on ? (
          <>
            <p className="break-words">{fact.text}</p>
            <p className="mt-1 text-xs text-rose-600">ตั้งเป็นข้อสอบจากประโยคนี้ไม่ได้ จะไม่ถูกนำไปใช้</p>
          </>
        ) : (
          <p className="break-words line-through decoration-white/30">{fact.text}</p>
        )}
      </div>
    </div>
  );
}

// ---------- 3. done ----------

function Done({ made, onAgain }: { made: Made; onAgain: () => void }) {
  return (
    <motion.section {...step} className="mt-8 grid gap-5" data-testid="pika-done">
      <div className="glass p-5 text-center sm:p-8">
        <div className="text-6xl" aria-hidden>
          🎉
        </div>
        <h2 className="mt-3 text-2xl font-extrabold text-balance">สร้างข้อสอบแล้ว {made.count} ข้อ</h2>
        <p className="mx-auto mt-2 max-w-xl break-words text-white/70">“{made.title}” อยู่ในเกมของฉันแล้ว ทำข้อสอบได้ทันที หรือเปิดใน Editor เพื่อแก้ถ้อยคำก่อน</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href={`/exam/${made.id}`} className="btn btn-gold">
            📝 ทำข้อสอบ
          </Link>
          <Link href={`/editor?id=${made.id}`} className="btn btn-ghost">
            ✏️ แก้ใน Editor
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/host" className="btn btn-primary">
          ไปที่เกมของฉัน
        </Link>
        <button type="button" onClick={onAgain} className="btn btn-ghost">
          สร้างอีกชุด
        </button>
      </div>
    </motion.section>
  );
}
