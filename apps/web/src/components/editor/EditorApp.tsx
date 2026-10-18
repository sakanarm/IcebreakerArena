'use client';

import { AnimatePresence, motion, useAnimate } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateGame, type Game } from '@icebreaker/shared';
import { downloadText } from '@/lib/csv';
import { blankGame, copyGame, deleteMyGame, dropBlankOptions, findGame, isSample, newId, saveMyGame } from '@/lib/games';
import { createRoom } from '@/lib/host';
import { withBase } from '@/lib/paths';
import { WaitingDots } from '../motion-bits';
import { findQuestion, findRound, gameIssues, issuesAt, selectionFor, type Edit, type Selection } from './model';
import { Outline } from './Outline';
import { GameSettings, RoundEditor } from './Panels';
import { QuestionEditor } from './QuestionEditor';

type SaveState = 'new' | 'pending' | 'saved';

const MAX_IMPORT_BYTES = 1_000_000;

/** The game editor: outline on the left, the selected game / round / question on the right. */
export function EditorApp({ id }: { id: string | null }) {
  const router = useRouter();
  const [game, setGame] = useState<Game | null>(null);
  const [sel, setSel] = useState<Selection>({ kind: 'game' });
  const [saveState, setSaveState] = useState<SaveState>('new');
  const [toast, setToast] = useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  /** the latest edit not yet written, so leaving the page mid-typing still keeps it */
  const unsaved = useRef<Game | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [problemsRef, animate] = useAnimate<HTMLButtonElement>();

  // saved games live in localStorage, so loading waits for the browser
  useEffect(() => {
    let found = id ? findGame(id) : undefined;
    if (found && isSample(found.id)) {
      // samples stay untouched: edit a copy of them
      found = copyGame(found);
      saveMyGame(found);
      history.replaceState(null, '', withBase(`/editor?id=${found.id}`));
    } else if (id && !found) {
      setToast('ไม่พบเกมนี้ในเบราว์เซอร์นี้ เลยเริ่มเกมใหม่ให้แทน');
    }
    const first = found?.rounds[0]?.questions[0];
    setGame(found ?? blankGame());
    setSel(first ? { kind: 'question', id: first.id } : { kind: 'game' });
    setSaveState(found ? 'saved' : 'new');
  }, [id]);

  const edit: Edit = useCallback((mutate) => {
    setGame((g) => {
      if (!g) return g;
      const next = structuredClone(g);
      mutate(next);
      return next;
    });
    setSaveState('pending');
  }, []);

  const writeNow = useCallback((g: Game) => {
    saveMyGame(g);
    unsaved.current = null;
    setSaveState('saved');
    if (new URLSearchParams(location.search).get('id') !== g.id) history.replaceState(null, '', withBase(`/editor?id=${g.id}`));
  }, []);

  // autosave shortly after the last change
  useEffect(() => {
    if (!game || saveState !== 'pending') return;
    unsaved.current = game;
    const t = setTimeout(() => writeNow(game), 600);
    return () => clearTimeout(t);
  }, [game, saveState, writeNow]);

  useEffect(() => {
    const flush = () => {
      if (unsaved.current) saveMyGame(unsaved.current);
      unsaved.current = null;
    };
    // Ctrl/Cmd+S out of habit: save right away instead of the browser's "save page"
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (unsaved.current) writeNow(unsaved.current);
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('keydown', onKey);
      flush();
    };
  }, [writeNow]);

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

  if (!game) {
    return (
      <div className="grid min-h-dvh place-items-center text-xl">
        <span className="flex items-center gap-3">
          กำลังเปิด Editor <WaitingDots />
        </span>
      </div>
    );
  }

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
    writeNow(game);
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
    const imported = { ...res.game, id: newId('g') };
    saveMyGame(imported);
    router.push(`/editor?id=${imported.id}`);
  };

  const deleteGame = () => {
    if (!confirm(`ลบเกม “${game.title || 'ไม่มีชื่อ'}” ใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    unsaved.current = null;
    setSaveState('saved');
    deleteMyGame(game.id);
    router.push('/host');
  };

  const q = sel.kind === 'question' ? findQuestion(game, sel.id) : null;
  const r = sel.kind === 'round' ? findRound(game, sel.id) : null;
  const panelKey = q ? q.question.id : r ? r.round.id : 'game';
  const selLabel = q ? `ด่าน ${q.ri + 1} · ข้อ ${q.qi + 1}` : r ? `ด่าน ${r.ri + 1}` : 'ตั้งค่าเกม';

  return (
    <div className="min-h-dvh pb-16">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-3">
          <Link href="/host" className="btn btn-ghost shrink-0 px-3 text-base" aria-label="กลับไปหน้าเลือกเกม">
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

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[300px_minmax(0,1fr)]">
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
              <button type="button" onClick={() => fileInput.current?.click()} className="btn btn-ghost px-3 text-sm">
                ⬆️ นำเข้า JSON
              </button>
              <button type="button" onClick={exportJson} className="btn btn-ghost px-3 text-sm">
                ⬇️ ส่งออก JSON
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              เกมถูกบันทึกในเบราว์เซอร์นี้เท่านั้น ส่งออกเป็น JSON เพื่อย้ายเครื่อง หรือส่งให้เพื่อนร่วมทีมนำเข้าไปแก้ต่อ
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
                <GameSettings game={game} issues={gameIssues(errors)} edit={edit} onDelete={saveState === 'new' ? null : deleteGame} />
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

function SaveBadge({ state }: { state: SaveState }) {
  const text = state === 'saved' ? '✓ บันทึกแล้ว' : state === 'pending' ? 'กำลังบันทึก…' : 'ยังไม่ได้บันทึก';
  const color = state === 'saved' ? 'text-good' : state === 'pending' ? 'text-white/80' : 'text-gold';
  return (
    <span className="hidden w-28 shrink-0 text-right text-sm font-semibold md:block" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={`inline-block ${color}`}>
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
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
