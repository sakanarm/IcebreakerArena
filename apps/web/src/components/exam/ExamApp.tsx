'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { examSize, type ExamItem } from '@pika-arena/shared';
import {
  attemptOf,
  dropAttempt,
  finishAttempt,
  loadAttempt,
  loadPaper,
  saveAttempt,
  startAttempt,
  type Attempt,
  type ExamSetup,
  type LoadedPaper,
} from '@/lib/exam';
import { aiPaper } from '@/lib/exam-ai';
import { ExamResult } from './ExamResult';
import { ExamRun } from './ExamRun';
import { ExamStart } from './ExamStart';
import { ExamHeader } from './parts';

type View = 'start' | 'run' | 'result';

/** a timed sitting whose time ran out while the page was closed ends at its deadline */
const settle = (a: Attempt | null, now: number) => (a && a.finishedAt === null && a.deadline !== null && a.deadline <= now ? finishAttempt(a, now) : a);

/**
 * /exam/<code>: the paper behind the code, and this browser's sitting of it. Everything is read in
 * an effect, after the first paint, so the server's page and the browser's agree (no storage on the server).
 */
export function ExamApp({ code }: { code: string }) {
  const [loaded, setLoaded] = useState<LoadedPaper | { status: 'loading' }>({ status: 'loading' });
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [view, setView] = useState<View>('start');
  const [now, setNow] = useState(0);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let live = true;
    void loadPaper(code).then((p) => {
      if (!live) return;
      const t = Date.now();
      if (p.status === 'missing') dropAttempt(code);
      const a = p.status === 'ready' ? settle(loadAttempt(code), t) : null;
      setAttempt(a);
      setNow(t);
      setView(!a ? 'start' : a.finishedAt === null ? 'run' : 'result');
      setLoaded(p);
    });
    return () => {
      live = false;
    };
  }, [code, tries]);

  // every change stays in this browser, so a refresh or a closed tab loses nothing
  useEffect(() => {
    if (attempt) saveAttempt(attempt);
  }, [attempt]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  const title = loaded.status === 'ready' ? loaded.paper.title : '';
  // a layout effect, not a plain one: leaving the paper, Next writes the next page's title in the same commit that
  // unmounts this one, and a plain effect's cleanup runs only after the observer has already put the name back
  useLayoutEffect(() => {
    if (!title) return;
    const want = `${title} · ข้อสอบ · MFEC Pika Arena`;
    let here = true;
    const put = () => {
      if (here && document.title !== want) document.title = want;
    };
    put();
    // after a click from /exam, Next writes this route's own title ("ข้อสอบ") once the page is in, which can be
    // after a sample (it needs no loading) has already set the paper's name: put the name back each time
    const watch = new MutationObserver(put);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      here = false;
      watch.disconnect();
    };
  }, [title]);

  // stable, so the sitting's own timers are not set up again on every change
  const change = useCallback((fn: (a: Attempt) => Attempt) => setAttempt((a) => (a ? fn(a) : a)), []);
  const finish = useCallback((spentMs: number) => {
    setAttempt((a) => (a ? finishAttempt({ ...a, spentMs }) : a));
    setView('result');
  }, []);
  const leave = useCallback((spentMs: number) => {
    setAttempt((a) => (a ? { ...a, spentMs } : a));
    setNow(Date.now());
    setView('start');
  }, []);

  if (loaded.status === 'loading') {
    return (
      <Plain>
        <p className="text-ex-muted" role="status">
          กำลังเปิดข้อสอบ…
        </p>
      </Plain>
    );
  }
  if (loaded.status === 'missing') {
    return (
      <Plain>
        <h1 className="text-2xl font-semibold">ไม่พบข้อสอบนี้</h1>
        <p className="mt-2 leading-relaxed text-ex-muted">
          {loaded.login
            ? 'ถ้านี่เป็นเกมของคุณ เข้าสู่ระบบก่อนแล้วจะเปิดได้ ถ้าได้ลิงก์มาจากคนอื่น ลิงก์อาจถูกปิดไปแล้ว'
            : 'ลิงก์อาจพิมพ์ผิด หรือเจ้าของปิดลิงก์ข้อสอบนี้ไปแล้ว ลองขอลิงก์ใหม่จากคนที่ส่งมาให้'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {loaded.login && (
            <Link href={`/login?next=${encodeURIComponent(`/exam/${code}`)}`} className="exam-btn exam-btn-primary">
              เข้าสู่ระบบ
            </Link>
          )}
          <Link href="/exam" className="exam-btn">
            ดูข้อสอบตัวอย่าง
          </Link>
        </div>
      </Plain>
    );
  }
  if (loaded.status === 'failed') {
    return (
      <Plain>
        <h1 className="text-2xl font-semibold">เปิดข้อสอบไม่ได้</h1>
        <p className="mt-2 leading-relaxed text-ex-muted">{loaded.message}</p>
        <button
          type="button"
          onClick={() => {
            setLoaded({ status: 'loading' });
            setTries((n) => n + 1);
          }}
          className="exam-btn exam-btn-primary mt-5"
        >
          ลองอีกครั้ง
        </button>
      </Plain>
    );
  }

  const { paper, origin } = loaded;
  const ai = aiPaper(code, origin);
  if (examSize(paper) === 0) {
    return (
      <Plain>
        <h1 className="text-2xl font-semibold wrap-anywhere">{paper.title || 'ข้อสอบ'}</h1>
        <p className="mt-2 leading-relaxed text-ex-muted">
          ยังไม่มีคำถามที่ทำเป็นข้อสอบได้ ข้อสอบใช้เฉพาะคำถามแบบควิซและจริง/เท็จที่มีเฉลย
        </p>
        {(origin === 'own' || origin === 'browser') && (
          <Link href={`/editor?id=${encodeURIComponent(code)}`} className="exam-btn exam-btn-primary mt-5">
            แก้เกมนี้
          </Link>
        )}
      </Plain>
    );
  }

  if (view === 'run' && attempt && attempt.finishedAt === null) {
    return <ExamRun attempt={attempt} onChange={change} onFinish={finish} onLeave={leave} ai={ai} />;
  }
  if (view === 'result' && attempt && attempt.finishedAt !== null) {
    return (
      <ExamResult
        attempt={attempt}
        ai={ai}
        onRetry={(items: ExamItem[]) => {
          setAttempt(attemptOf(code, attempt.title, items, 'practice'));
          setView('run');
        }}
        onNew={() => {
          setNow(Date.now());
          setView('start');
        }}
      />
    );
  }
  return (
    <ExamStart
      paper={paper}
      attempt={attempt}
      now={now}
      onStart={(setup: ExamSetup) => {
        setAttempt(startAttempt(code, paper, setup));
        setView('run');
      }}
      onResume={() => {
        const a = settle(attempt, Date.now());
        if (!a) return;
        setAttempt(a);
        setView(a.finishedAt === null ? 'run' : 'result');
      }}
    />
  );
}

function Plain({ children }: { children: React.ReactNode }) {
  return (
    <div className="exam-page">
      <ExamHeader />
      <main className="mx-auto max-w-3xl px-4 pt-10 pb-16">
        <div className="exam-card p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
