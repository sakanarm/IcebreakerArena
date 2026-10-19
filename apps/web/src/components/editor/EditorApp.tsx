'use client';

import { AnimatePresence, motion, useAnimate } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_GAMES, copyTitle, validateGame, type Game } from '@icebreaker/shared';
import { refreshAccount, useAccount, type Account, type AccountUser } from '@/lib/account';
import { ApiError, apiMessage, errorCode } from '@/lib/api';
import { cloud, enqueue, isServerId } from '@/lib/cloud';
import { downloadText } from '@/lib/csv';
import { blankGame, copyGame, deleteMyGame, dropBlankOptions, findGame, isSample, listMyGames, newId, saveMyGame } from '@/lib/games';
import { createRoom } from '@/lib/host';
import { withBase } from '@/lib/paths';
import { WaitingDots } from '../motion-bits';
import { switchedText } from '../AccountChip';
import { Notice } from '../Notice';
import { findQuestion, findRound, gameIssues, issuesAt, selectionFor, type Edit, type Selection } from './model';
import { Outline } from './Outline';
import { GameSettings, RoundEditor } from './Panels';
import { QuestionEditor } from './QuestionEditor';

/** conflict: someone saved a newer version elsewhere; gone: deleted elsewhere; login: the session ended */
type SaveState = 'new' | 'pending' | 'saved' | 'error' | 'conflict' | 'gone' | 'login';
type Problem = Extract<SaveState, 'error' | 'conflict' | 'gone' | 'login'>;
const isProblem = (s: SaveState): s is Problem => s === 'error' || s === 'conflict' || s === 'gone' || s === 'login';

/** Where the game is kept. A cloud game without an id is created on its first save. */
type Store = { kind: 'local' } | { kind: 'cloud'; id: string | null; version: number; sampleId?: string; deleted?: boolean };

const MAX_IMPORT_BYTES = 1_000_000;

/** The game editor. With accounts on it needs a login; without, games stay in this browser as before. */
export function EditorApp({ id }: { id: string | null }) {
  const account = useAccount();
  if (account.status === 'loading') return <Opening />;
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
    const next = `/editor${id ? `?id=${encodeURIComponent(id)}` : ''}`;
    return (
      <Notice
        emoji="🔑"
        title="เข้าสู่ระบบก่อนสร้างเกม"
        actions={
          <>
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn btn-primary">
              เข้าสู่ระบบ
            </Link>
            <Link href="/host" className="btn btn-ghost">
              กลับ
            </Link>
          </>
        }
      >
        เกมที่สร้างจะเก็บไว้ในบัญชีของคุณ เปิดแก้จากเครื่องไหนก็ได้ และคนอื่นมองไม่เห็นจนกว่าคุณจะแชร์
      </Notice>
    );
  }
  const user = account.mode === 'off' ? null : account.user;
  return <Editor key={user?.id ?? 'browser'} id={id} user={user} switched={account.switched} />;
}

function Opening() {
  return (
    <div className="grid min-h-dvh place-items-center text-xl">
      <span className="flex items-center gap-3">
        กำลังเปิด Editor <WaitingDots />
      </span>
    </div>
  );
}

type Switched = Extract<Account, { status: 'ready' }>['switched'];

/** The session ended or became someone else's: saving waits until the person logs back in as the page's user. */
const isLoginCode = (code: string) => code === 'login_required' || code === 'wrong_user';

/** Outline on the left, the selected game / round / question on the right. */
function Editor({ id, user, switched }: { id: string | null; user: AccountUser | null; switched: Switched }) {
  const router = useRouter();
  const inCloud = user !== null;
  const [game, setGame] = useState<Game | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tainted, setTainted] = useState(false);
  /** logged in, but this game stays in the browser because the server refused it */
  const [keptHere, setKeptHere] = useState(false);
  const [sel, setSel] = useState<Selection>({ kind: 'game' });
  const [saveState, setSaveState] = useState<SaveState>('new');
  const [toast, setToast] = useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [fixing, setFixing] = useState(false);
  const store = useRef<Store>({ kind: 'local' });
  /** the latest edit not yet written, so leaving the page mid-typing still keeps it */
  const unsaved = useRef<Game | null>(null);
  /** counts edits; a save only marks the game saved if nothing changed while it was on its way */
  const edits = useRef(0);
  const savedAt = useRef(0);
  /** the edit count of the newest server save queued; an older one that fails must not bring its game back */
  const queuedAt = useRef(0);
  const latest = useRef<Game | null>(null);
  const alive = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [problemsRef, animate] = useAnimate<HTMLButtonElement>();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    latest.current = game;
  }, [game]);

  const showUrl = (gameId: string) => {
    if (alive.current && new URLSearchParams(location.search).get('id') !== gameId) history.replaceState(null, '', withBase(`/editor?id=${gameId}`));
  };

  // the game comes from the browser's storage or from the server, so loading waits for the browser
  useEffect(() => {
    let cancelled = false;
    const open = (found: Game | null, s: Store, opts: { saved?: boolean; tainted?: boolean; note?: string } = {}) => {
      if (cancelled) return;
      store.current = s;
      setKeptHere(s.kind === 'local');
      const first = found?.rounds[0]?.questions[0];
      setGame(found ?? blankGame());
      setSel(first ? { kind: 'question', id: first.id } : { kind: 'game' });
      setSaveState(opts.saved ? 'saved' : 'new');
      setTainted(!!opts.tainted);
      if (opts.note) setToast(opts.note);
    };

    if (!inCloud) {
      let found = id ? findGame(id) : undefined;
      if (found && isSample(found.id)) {
        // samples stay untouched: edit a copy of them
        found = copyGame(found);
        saveMyGame(found);
        history.replaceState(null, '', withBase(`/editor?id=${found.id}`));
      }
      open(found ?? null, { kind: 'local' }, { saved: !!found, note: id && !found ? 'ไม่พบเกมนี้ในเบราว์เซอร์นี้ เลยเริ่มเกมใหม่ให้แทน' : undefined });
      return;
    }

    const fresh = (sampleId?: string): Store => ({ kind: 'cloud', id: null, version: 0, sampleId });
    const notFound = 'ไม่พบเกมนี้ในบัญชีของคุณ เลยเริ่มเกมใหม่ให้แทน';
    void (async () => {
      try {
        if (!id) return open(null, fresh());
        const sample = SAMPLE_GAMES.find((g) => g.id === id);
        // a copy of the sample, created in the account on its first save
        if (sample) return open(copyGame(sample), fresh(sample.id));
        if (isServerId(id)) {
          const rec = await cloud.get(id);
          return open(rec.game, { kind: 'cloud', id: rec.id, version: rec.version }, { saved: true, tainted: rec.tainted });
        }
        // an old link to a game kept in this browser: move it into the account (safe to repeat)
        if (!/^[\w-]{1,64}$/.test(id)) return open(null, fresh(), { note: notFound });
        const local = listMyGames().find((g) => g.id === id);
        if (!local) {
          // moved already (from this browser or another): open the saved game
          const movedId = await cloud.findLocal(id);
          const rec = await cloud.get(movedId);
          if (cancelled) return;
          showUrl(rec.id);
          return open(rec.game, { kind: 'cloud', id: rec.id, version: rec.version }, { saved: true, tainted: rec.tainted });
        }
        let moved: Awaited<ReturnType<typeof cloud.importLocal>>;
        try {
          moved = await cloud.importLocal(id, local);
        } catch (e) {
          // refused (too big, a field too long): edit it here in the browser until it can be moved
          if (!(e instanceof ApiError && [400, 413, 415].includes(e.status))) throw e;
          return open(local, { kind: 'local' }, { saved: true, note: `ย้ายเกมนี้เข้าบัญชีไม่ได้: ${apiMessage(e)} แก้ในเบราว์เซอร์นี้ก่อน แล้วกด “ย้ายเข้าบัญชี” ในหน้าเลือกเกม` });
        }
        deleteMyGame(id);
        const rec = await cloud.get(moved.id);
        if (cancelled) return;
        showUrl(rec.id);
        const note = moved.separate
          ? 'เกมนี้ในเบราว์เซอร์ต่างจากที่ย้ายเข้าบัญชีไว้ก่อน เลยเก็บเป็นอีกเกม (ชื่อลงท้าย “จากเบราว์เซอร์”)'
          : 'ย้ายเกมนี้จากเบราว์เซอร์เข้าบัญชีของคุณแล้ว';
        open(rec.game, { kind: 'cloud', id: rec.id, version: rec.version }, { saved: true, tainted: rec.tainted, note });
      } catch (e) {
        if (cancelled) return;
        const code = errorCode(e);
        if (code === 'not_found') return open(null, fresh(), { note: notFound });
        if (isLoginCode(code)) void refreshAccount();
        setLoadError(apiMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // showUrl only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, inCloud]);

  const edit: Edit = useCallback((mutate) => {
    setGame((g) => {
      if (!g) return g;
      const next = structuredClone(g);
      mutate(next);
      unsaved.current = next;
      return next;
    });
    edits.current++;
    // a conflict or an ended login waits for the person to choose; other edits save as usual
    setSaveState((s) => (s === 'conflict' || s === 'gone' || s === 'login' ? s : 'pending'));
  }, []);

  /** Writes the game now: to this browser at once, or to the server after any save already on its way. */
  const writeNow = useCallback((g: Game) => {
    unsaved.current = null;
    const s = store.current;
    if (s.kind === 'local') {
      saveMyGame(g);
      setSaveState('saved');
      showUrl(g.id);
      return;
    }
    if (s.deleted) return;
    const at = edits.current;
    queuedAt.current = at;
    enqueue(async () => {
      // deleted while this save waited: nothing was written
      if (s.deleted) return false;
      if (s.id === null) {
        const rec = await cloud.create(g, s.sampleId ? { sampleId: s.sampleId } : {});
        s.id = rec.id;
        s.version = rec.version;
        showUrl(rec.id);
      } else {
        s.version = await cloud.save(s.id, g, s.version);
      }
      return true;
    }).then(
      (written) => {
        if (!written) return;
        savedAt.current = Math.max(savedAt.current, at);
        if (alive.current && edits.current === at) setSaveState('saved');
      },
      (e) => {
        const code = errorCode(e);
        if (isLoginCode(code)) void refreshAccount();
        if (!alive.current) return;
        // the edit is still to be written: keep it for "save again" and for leaving the page,
        // unless a newer save is already on its way (this older game would overwrite it later)
        if (queuedAt.current === at) unsaved.current ??= g;
        setSaveState(code === 'conflict' ? 'conflict' : code === 'not_found' ? 'gone' : isLoginCode(code) ? 'login' : 'error');
        if (code === 'too_many_games' || code === 'too_large' || code === 'too_long') setToast(apiMessage(e));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave shortly after the last change
  useEffect(() => {
    if (!game || saveState !== 'pending') return;
    unsaved.current = game;
    const t = setTimeout(() => writeNow(game), inCloud ? 800 : 600);
    return () => clearTimeout(t);
  }, [game, saveState, writeNow, inCloud]);

  useEffect(() => {
    // leaving the editor in the app: save what is left (a server save finishes after the page changes)
    const flush = () => {
      if (unsaved.current) writeNow(unsaved.current);
    };
    // Ctrl/Cmd+S out of habit: save right away instead of the browser's "save page"
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flush();
      }
    };
    // closing the tab can't wait for the server, so ask first while changes are still unsaved
    const onLeave = (e: BeforeUnloadEvent) => {
      if (store.current.kind === 'local') {
        if (unsaved.current) saveMyGame(unsaved.current);
        unsaved.current = null;
        return;
      }
      if (store.current.deleted || edits.current === savedAt.current) return;
      flush();
      e.preventDefault();
      e.returnValue = '';
    };
    // phones often close or freeze a tab without beforeunload: write as soon as the page is hidden
    const onHide = () => {
      if (!unsaved.current) return;
      if (store.current.kind === 'local') {
        saveMyGame(unsaved.current);
        unsaved.current = null;
      } else {
        flush();
      }
    };
    const onVisibility = () => document.visibilityState === 'hidden' && onHide();
    window.addEventListener('beforeunload', onLeave);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
      flush();
    };
  }, [writeNow]);

  const wasSwitched = useRef(switched);
  useEffect(() => {
    const back = wasSwitched.current && !switched;
    wasSwitched.current = switched;
    if (back) setSaveState((st) => (st === 'login' ? 'pending' : st));
  }, [switched]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const errors = useMemo(() => {
    if (!game) return [];
    const res = validateGame(dropBlankOptions(game));
    return res.ok ? [] : res.errors;
  }, [game]);

  if (loadError) {
    return (
      <Notice
        emoji="📡"
        title="เปิดเกมไม่ได้"
        actions={
          <>
            <button type="button" onClick={() => location.reload()} className="btn btn-primary">
              ลองใหม่
            </button>
            <Link href="/host" className="btn btn-ghost">
              กลับ
            </Link>
          </>
        }
      >
        {loadError}
      </Notice>
    );
  }
  if (!game) return <Opening />;

  const select = (s: Selection) => {
    setSel(s);
    setOutlineOpen(false);
  };

  const play = async () => {
    if (errors.length > 0) {
      setProblemsOpen(true);
      void animate(problemsRef.current, { x: [0, -10, 10, -6, 6, 0] }, { duration: 0.4 });
      return;
    }
    const s = store.current;
    if (s.kind === 'local' || s.id === null || edits.current !== savedAt.current) writeNow(game);
    setStarting(true);
    const res = await createRoom(game);
    if (res.ok) return router.push(`/host/${res.pin}`);
    setToast(res.message);
    setStarting(false);
  };

  const exportJson = () => {
    const name = (game.title.trim() || 'icebreaker-game').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60);
    downloadText(`${name}.json`, JSON.stringify(dropBlankOptions(game), null, 2), 'application/json');
  };

  const importJson = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) return setToast('ไฟล์ใหญ่เกินไปสำหรับไฟล์เกม');
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setToast('อ่านไฟล์ไม่ได้: ต้องเป็นไฟล์เกม .json ที่ส่งออกจากหน้านี้');
    }
    const res = validateGame(data);
    if (!res.ok) {
      const more = res.errors.length > 3 ? ` และอีก ${res.errors.length - 3} จุด` : '';
      return setToast(`นำเข้าไม่ได้: ${res.errors.slice(0, 3).join(' · ')}${more}`);
    }
    if (!inCloud) {
      const imported = { ...res.game, id: newId('g') };
      saveMyGame(imported);
      return router.push(`/editor?id=${imported.id}`);
    }
    try {
      const rec = await cloud.create(res.game, { from: 'import' });
      router.push(`/editor?id=${rec.id}`);
    } catch (e) {
      setToast(apiMessage(e));
    }
  };

  const deleteGame = async () => {
    if (!confirm(`ลบเกม “${game.title || 'ไม่มีชื่อ'}” ใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    unsaved.current = null;
    const s = store.current;
    if (s.kind === 'local') {
      setSaveState('saved');
      deleteMyGame(game.id);
      return router.push('/host');
    }
    // saves still queued must not bring it back; one already running may only now have an id
    s.deleted = true;
    try {
      await enqueue(async () => {
        if (s.id) await cloud.remove(s.id);
      });
    } catch (e) {
      if (errorCode(e) !== 'not_found') {
        // not deleted after all: write what saves skipped meanwhile (the state may already be
        // 'pending', which would not start the autosave again)
        s.deleted = false;
        if (isLoginCode(errorCode(e))) void refreshAccount();
        setToast(apiMessage(e));
        if (latest.current && edits.current !== savedAt.current) writeNow(latest.current);
        return;
      }
    }
    router.push('/host');
  };

  /** conflict: replace this page's version with the one saved elsewhere */
  const loadLatest = async () => {
    const s = store.current;
    if (s.kind !== 'cloud' || !s.id) return;
    if (!confirm('โหลดฉบับล่าสุดที่บันทึกไว้? สิ่งที่แก้ในหน้านี้ตั้งแต่บันทึกครั้งก่อนจะหายไป')) return;
    setFixing(true);
    const at = edits.current;
    try {
      const rec = await enqueue(() => cloud.get(s.id!));
      if (edits.current !== at) return setToast('มีการแก้ระหว่างโหลด เลยยังไม่ได้แทนที่ กด “โหลดฉบับล่าสุด” อีกครั้ง');
      s.version = rec.version;
      unsaved.current = null;
      savedAt.current = ++edits.current;
      setGame(rec.game);
      setTainted(rec.tainted);
      setSel({ kind: 'game' });
      setSaveState('saved');
    } catch (e) {
      setSaveState(errorCode(e) === 'not_found' ? 'gone' : 'error');
      setToast(apiMessage(e));
    } finally {
      setFixing(false);
    }
  };

  /** conflict or deleted elsewhere: keep this page's version as a separate game */
  const saveAsNew = async () => {
    const s = store.current;
    if (s.kind !== 'cloud') return;
    setFixing(true);
    const title = copyTitle(game.title);
    const mine = { ...game, title };
    const at = edits.current;
    try {
      const rec = await enqueue(async () => {
        // copying on the server keeps what only the server knows (e.g. that the game holds internal content)
        const base = s.id ? await cloud.copy(s.id).catch((e) => (errorCode(e) === 'not_found' && !tainted ? null : Promise.reject(e))) : null;
        if (!base) return cloud.create(mine);
        try {
          const version = await cloud.save(base.id, mine, base.version);
          return { ...base, version };
        } catch (e) {
          // a copy holding the other version would only confuse: take it back
          await cloud.remove(base.id).catch(() => {});
          throw e;
        }
      });
      store.current = { kind: 'cloud', id: rec.id, version: rec.version };
      setGame((g) => (g ? { ...g, title } : g));
      if (edits.current === at) {
        unsaved.current = null;
        savedAt.current = ++edits.current;
        setSaveState('saved');
      } else {
        // edits made meanwhile go to the new game too
        edits.current++;
        setSaveState('pending');
      }
      showUrl(rec.id);
      setToast('บันทึกฉบับนี้เป็นเกมใหม่แล้ว');
    } catch (e) {
      if (isLoginCode(errorCode(e))) void refreshAccount();
      setToast(apiMessage(e));
    } finally {
      setFixing(false);
    }
  };

  const q = sel.kind === 'question' ? findQuestion(game, sel.id) : null;
  const r = sel.kind === 'round' ? findRound(game, sel.id) : null;
  const panelKey = q ? q.question.id : r ? r.round.id : 'game';
  const selLabel = q ? `ด่าน ${q.ri + 1} · ข้อ ${q.qi + 1}` : r ? `ด่าน ${r.ri + 1}` : 'ตั้งค่าเกม';

  return (
    <div className="min-h-dvh pb-16">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-3">
          <Link
            href="/host"
            onClick={(e) => {
              if (isProblem(saveState) && edits.current !== savedAt.current && !confirm('เกมนี้ยังไม่ได้บันทึก ออกจากหน้านี้แล้วสิ่งที่แก้จะหายไป ออกเลยไหม?')) e.preventDefault();
            }}
            className="btn btn-ghost shrink-0 px-3 text-base"
            aria-label="กลับไปหน้าเลือกเกม"
          >
            ← <span className="hidden sm:inline">เกมทั้งหมด</span>
          </Link>
          <button type="button" onClick={() => select({ kind: 'game' })} className="min-w-0 flex-1 truncate text-left font-display text-lg font-semibold">
            {game.title.trim() || <span className="text-white/50">เกมใหม่ (ยังไม่มีชื่อ)</span>}
          </button>
          <SaveBadge state={saveState} />
          <button
            ref={problemsRef}
            type="button"
            onClick={() => setProblemsOpen((o) => !o)}
            aria-expanded={problemsOpen}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${errors.length ? 'bg-gold text-ink' : 'bg-good/20 text-good'}`}
          >
            {errors.length ? `⚠️ ขาด ${errors.length}` : '✓ พร้อม'}
          </button>
          <button type="button" onClick={play} disabled={starting} className="btn btn-gold shrink-0 px-4 text-base">
            {starting ? 'กำลังเปิดห้อง…' : '▶ เล่นเลย'}
          </button>
        </div>
        {switched && !isProblem(saveState) && (
          <div role="status" className="border-t border-white/10 bg-gold text-ink">
            <p className="mx-auto max-w-7xl px-4 py-2 text-sm font-semibold">⚠️ {switchedText(user!, switched.to)}</p>
          </div>
        )}
        {isProblem(saveState) && (
          <SaveProblem
            state={saveState}
            userName={user?.name ?? ''}
            busy={fixing}
            onRetry={() => {
              setSaveState('pending');
              writeNow(game);
            }}
            onLoadLatest={loadLatest}
            onSaveAsNew={saveAsNew}
          />
        )}
        <AnimatePresence>
          {problemsOpen && (
            <Problems
              errors={errors}
              onPick={(e) => {
                select(selectionFor(game, e));
                setProblemsOpen(false);
              }}
              onClose={() => setProblemsOpen(false)}
            />
          )}
        </AnimatePresence>
      </header>

      <div inert={fixing} className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <button
            type="button"
            onClick={() => setOutlineOpen((o) => !o)}
            aria-expanded={outlineOpen}
            className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 font-semibold lg:hidden"
          >
            <span>📋 {selLabel}</span>
            <span aria-hidden>{outlineOpen ? '▴' : '▾'}</span>
          </button>
          <div className={`${outlineOpen ? 'block' : 'hidden'} mt-3 lg:mt-0 lg:block`}>
            <Outline game={game} sel={sel} errors={errors} edit={edit} onSelect={select} />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => fileInput.current?.click()} className={`btn btn-ghost px-3 text-sm ${tainted ? 'col-span-2' : ''}`}>
                ⬆️ นำเข้า JSON
              </button>
              {/* a game built from internal content stays in the account: no file to pass around */}
              {!tainted && (
                <button type="button" onClick={exportJson} className="btn btn-ghost px-3 text-sm">
                  ⬇️ ส่งออก JSON
                </button>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              {inCloud && keptHere
                ? 'เกมนี้ยังอยู่ในเบราว์เซอร์นี้เพราะย้ายเข้าบัญชีไม่ได้ แก้ส่วนที่ยาวหรือใหญ่เกินแล้วกด “ย้ายเข้าบัญชี” ในหน้าเลือกเกม'
                : inCloud
                ? `เก็บไว้ในบัญชีของ ${user.name} เปิดแก้จากเครื่องไหนก็ได้ คนอื่นมองไม่เห็นจนกว่าคุณจะแชร์เข้าคลังกลางในหน้าเลือกเกม`
                : 'เกมถูกบันทึกในเบราว์เซอร์นี้เท่านั้น ส่งออกเป็น JSON เพื่อย้ายเครื่อง หรือส่งให้เพื่อนร่วมทีมนำเข้าไปแก้ต่อ'}
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void importJson(file);
              }}
            />
          </div>
        </aside>

        <main className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panelKey}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18 }}
            >
              {q ? (
                <QuestionEditor
                  question={q.question}
                  round={q.round}
                  ri={q.ri}
                  qi={q.qi}
                  issues={issuesAt(errors, q.ri, q.qi)}
                  edit={edit}
                  onSelect={select}
                />
              ) : r ? (
                <RoundEditor game={game} ri={r.ri} issues={issuesAt(errors, r.ri)} edit={edit} onSelect={select} />
              ) : (
                <GameSettings game={game} issues={gameIssues(errors)} edit={edit} onDelete={saveState === 'new' ? null : () => void deleteGame()} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-lg items-start gap-3 rounded-2xl bg-ink px-5 py-4 shadow-2xl ring-1 ring-white/15"
          >
            <span className="flex-1">{toast}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="ปิดข้อความ" className="text-white/60">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const BADGE: Record<SaveState, { text: string; color: string }> = {
  new: { text: 'ยังไม่ได้บันทึก', color: 'text-gold' },
  pending: { text: 'กำลังบันทึก…', color: 'text-white/80' },
  saved: { text: '✓ บันทึกแล้ว', color: 'text-good' },
  error: { text: '⚠️ บันทึกไม่สำเร็จ', color: 'text-bad' },
  conflict: { text: '⚠️ ยังไม่ได้บันทึก', color: 'text-bad' },
  gone: { text: '⚠️ ยังไม่ได้บันทึก', color: 'text-bad' },
  login: { text: '⚠️ ยังไม่ได้บันทึก', color: 'text-bad' },
};

function SaveBadge({ state }: { state: SaveState }) {
  const { text, color } = BADGE[state];
  return (
    <span className="hidden w-36 shrink-0 text-right text-sm font-semibold md:block" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={`inline-block ${color}`}>
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const PROBLEM_TEXT: Record<Problem, string> = {
  error: 'บันทึกไม่สำเร็จ เพราะเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ สิ่งที่แก้ยังอยู่ในหน้านี้',
  conflict: 'เกมนี้ถูกแก้และบันทึกจากหน้าต่างหรือเครื่องอื่น ฉบับในหน้านี้จึงยังไม่ได้บันทึก',
  gone: 'เกมนี้ถูกลบไปแล้วจากหน้าต่างหรือเครื่องอื่น ฉบับในหน้านี้ยังไม่ได้บันทึก',
  login: 'ยังไม่ได้บันทึก เพราะหมดเวลาเข้าสู่ระบบ หรือเบราว์เซอร์นี้เข้าสู่ระบบเป็นบัญชีอื่นจากอีกแท็บ',
};

/** Why the last save failed, with the ways out. Shown under the header until it is resolved. */
function SaveProblem({
  state,
  userName,
  busy,
  onRetry,
  onLoadLatest,
  onSaveAsNew,
}: {
  state: Problem;
  userName: string;
  busy: boolean;
  onRetry: () => void;
  onLoadLatest: () => void;
  onSaveAsNew: () => void;
}) {
  const action = 'btn px-4 py-2 text-sm';
  return (
    <div role="alert" className="border-t border-white/10 bg-bad/90">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <p className="flex-1 font-semibold">
          ⚠️ {PROBLEM_TEXT[state]}
          {state === 'login' && ` เข้าสู่ระบบเป็น ${userName} ในแท็บใหม่ แล้วกลับมาที่หน้านี้ ระบบจะบันทึกให้เอง`}
        </p>
        <div className="flex flex-wrap gap-2">
          {state === 'conflict' && (
            <button type="button" disabled={busy} onClick={onLoadLatest} className={`${action} btn-light`}>
              โหลดฉบับล่าสุด
            </button>
          )}
          {(state === 'conflict' || state === 'gone') && (
            <button type="button" disabled={busy} onClick={onSaveAsNew} className={`${action} btn-gold`}>
              บันทึกฉบับนี้เป็นเกมใหม่
            </button>
          )}
          {state === 'login' && (
            <a href={withBase('/login?next=/host')} target="_blank" rel="noopener" className={`${action} btn-light`}>
              เข้าสู่ระบบ ↗
            </a>
          )}
          {(state === 'login' || state === 'error') && (
            <button type="button" disabled={busy} onClick={onRetry} className={`${action} btn-gold`}>
              บันทึกอีกครั้ง
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Everything that still blocks "Play", each one a link to where it is. */
function Problems({ errors, onPick, onClose }: { errors: string[]; onPick: (error: string) => void; onClose: () => void }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden border-t border-white/10"
    >
      <div className="mx-auto max-w-7xl px-4 py-4">
        {errors.length === 0 ? (
          <p className="font-semibold text-good">เกมนี้พร้อมเล่นแล้ว กด “เล่นเลย” ได้เลย 🎉</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">ก่อนเล่นต้องแก้อีก {errors.length} จุด (แตะเพื่อไปที่จุดนั้น)</p>
              <button type="button" onClick={onClose} className="text-sm text-white/60">
                ปิด
              </button>
            </div>
            <ul className="mt-2 grid max-h-60 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {errors.slice(0, 40).map((e) => (
                <li key={e}>
                  <button type="button" onClick={() => onPick(e)} className="w-full rounded-xl bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10">
                    {e}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </motion.div>
  );
}
