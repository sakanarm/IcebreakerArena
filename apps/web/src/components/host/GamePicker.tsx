'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { SAMPLE_GAMES, validateGame, type Game } from '@icebreaker/shared';
import { refreshAccount, useAccount, type AccountUser } from '@/lib/account';
import { ApiError, apiMessage } from '@/lib/api';
import { cloud, settled, type CatalogEntry, type GameRecord, type ReportReason } from '@/lib/cloud';
import { copyGame, countQuestions, deleteMyGame, dropBlankOptions, listMyGames, saveMyGame } from '@/lib/games';
import { createRoom } from '@/lib/host';
import { AccountChip, switchedText } from '../AccountChip';
import { WaitingDots } from '../motion-bits';
import { ANSWER_BG, AnswerShape, FloatingShapes, Logo } from '../shapes';
import { OpenRooms } from './OpenRooms';

type Toast = { text: string; tone: 'bad' | 'good' };

/** Host home: pick one of your games, a sample, or a shared game, and open a live room for it. */
export function GamePicker() {
  const router = useRouter();
  const account = useAccount();
  const [starting, setStarting] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const start = async (game: Game) => {
    setToast(null);
    setStarting(game.id);
    const res = await createRoom(game);
    if (res.ok) return router.push(`/host/${res.pin}`);
    setToast({ text: res.message, tone: 'bad' });
    setStarting(null);
  };

  const ready = account.status === 'ready';
  const user = ready ? account.user : null;
  const accounts = ready && account.mode !== 'off';
  const say = useCallback((text: string, tone: Toast['tone'] = 'bad') => setToast({ text, tone }), []);

  return (
    <div className="relative min-h-dvh px-5 pt-6 pb-16">
      <FloatingShapes opacity={0.07} />
      <div className="relative mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" aria-label="กลับหน้าแรก">
            <Logo small />
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <AccountChip />
            <Link href="/editor" className="btn btn-gold">
              ＋ สร้างเกมใหม่
            </Link>
          </div>
        </header>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-10">
          <h1 className="text-4xl font-extrabold md:text-5xl">เลือกเกมที่จะเล่น</h1>
          <p className="mt-2 text-lg text-white/70">กด “เริ่มห้อง” แล้วเปิดจอนี้ขึ้นโปรเจกเตอร์ ให้ทุกคนสแกน QR หรือใส่ PIN</p>
        </motion.div>

        <OpenRooms say={say} />

        {account.status === 'loading' ? (
          <p className="mt-10 flex items-center gap-3 text-white/70">
            กำลังโหลดเกม <WaitingDots />
          </p>
        ) : account.status === 'error' ? (
          <Banner emoji="📡" text="โหลดข้อมูลบัญชีไม่ได้ ตรวจว่าเครื่องนี้ต่อ Wi-Fi บริษัทหรือ VPN อยู่">
            <button type="button" onClick={() => void refreshAccount()} className="btn btn-light px-4 text-base">
              ลองใหม่
            </button>
          </Banner>
        ) : !accounts ? (
          <BrowserGames starting={starting} onStart={start} />
        ) : user ? (
          <>
            {account.switched && (
              <Banner emoji="⚠️" text={switchedText(user, account.switched.to)}>
                {account.switched.to ? (
                  <button type="button" onClick={() => location.reload()} className="btn btn-light px-4 text-base">
                    โหลดหน้าใหม่
                  </button>
                ) : (
                  <Link href="/login?next=/host" className="btn btn-light px-4 text-base">
                    เข้าสู่ระบบ
                  </Link>
                )}
              </Banner>
            )}
            <AccountGames key={user.id} user={user} starting={starting} onStart={start} say={say} />
          </>
        ) : (
          <Banner emoji="🔑" text="เข้าสู่ระบบเพื่อสร้างเกม เก็บเกมไว้ในบัญชี และเล่นเกมที่เพื่อนแชร์ไว้ในคลังกลาง">
            <Link href="/login?next=/host" className="btn btn-light px-4 text-base">
              เข้าสู่ระบบ
            </Link>
          </Banner>
        )}

        {ready && !user && (
          <Section title="เกมตัวอย่าง" note="เล่นได้ทันที">
            {SAMPLE_GAMES.map((g, i) => (
              <GameCard key={g.id} game={g} index={i + 2} tag="ตัวอย่าง" busy={starting === g.id} locked={!!starting} onStart={start}>
                {!accounts && <CopySampleButton game={g} />}
              </GameCard>
            ))}
          </Section>
        )}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            role={toast.tone === 'bad' ? 'alert' : 'status'}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className={`fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-lg items-start gap-3 rounded-2xl px-5 py-4 font-semibold shadow-2xl ${toast.tone === 'bad' ? 'bg-bad' : 'bg-good'}`}
          >
            <span aria-hidden>{toast.tone === 'bad' ? '⚠️' : '✓'}</span>
            <span className="flex-1">{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} className="text-white/80" aria-label="ปิดข้อความ">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** No accounts: games live in this browser's storage, as before. */
function BrowserGames({ starting, onStart }: { starting: string | null; onStart: (g: Game) => void }) {
  const [mine, setMine] = useState<Game[] | null>(null);

  // saved games live in localStorage, which only exists after mount
  useEffect(() => setMine(listMyGames()), []);

  const remove = (game: Game) => {
    if (!confirm(`ลบเกม “${game.title || 'ไม่มีชื่อ'}” ใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    deleteMyGame(game.id);
    setMine(listMyGames());
  };

  return (
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
              onStart={onStart}
              fixHref={ready ? null : `/editor?id=${g.id}`}
            >
              {ready && <EditLink id={g.id} />}
              <DeleteButton title={g.title} onClick={() => remove(g)} />
            </GameCard>
          );
        })
      )}
    </Section>
  );
}

function CopySampleButton({ game }: { game: Game }) {
  const router = useRouter();
  const copyToEdit = () => {
    const copy = copyGame(game);
    saveMyGame(copy);
    router.push(`/editor?id=${copy.id}`);
  };
  return (
    <button type="button" onClick={copyToEdit} className="btn bg-slate-100 px-4 text-base text-ink">
      📄 ทำสำเนาไปแก้
    </button>
  );
}

/** Logged in: the user's own games (nobody else sees them) and the catalog everyone shares. */
function AccountGames({
  user,
  starting,
  onStart,
  say,
}: {
  user: AccountUser;
  starting: string | null;
  onStart: (g: Game) => void;
  say: (text: string, tone?: 'bad' | 'good') => void;
}) {
  const router = useRouter();
  const [games, setGames] = useState<GameRecord[] | null>(null);
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [reporting, setReporting] = useState<CatalogEntry | null>(null);

  const load = useCallback(async () => {
    try {
      // the editor's last save may still be on its way after leaving it
      await settled();
      const [g, e] = await Promise.all([cloud.list(), cloud.catalog()]);
      setGames(g);
      setEntries(e);
      setLoadError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'login_required' || e.code === 'wrong_user')) void refreshAccount();
      setLoadError(apiMessage(e));
    }
  }, []);

  useEffect(() => void load(), [load]);

  /**
   * Runs one action at a time; a failure is shown, and the lists reload either way. `key` is
   * "<action>:<id>", so only the button that was pressed says it is working.
   */
  const act = async (key: string, job: () => Promise<string | void>) => {
    setWorking(key);
    try {
      const done = await job();
      if (done) say(done, 'good');
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'login_required' || e.code === 'wrong_user')) void refreshAccount();
      const errors = e instanceof ApiError && Array.isArray(e.data.errors) ? `: ${e.data.errors.slice(0, 2).join(' · ')}` : '';
      say(apiMessage(e) + errors);
    } finally {
      setWorking(null);
      await load();
    }
  };

  const share = (rec: GameRecord) => {
    const again = rec.sharedStatus === 'listed';
    const ok = again
      ? confirm(`อัปเดตฉบับในคลังกลางให้เป็น “${rec.game.title}” ตอนนี้ใช่ไหม?`)
      : confirm(
          `แชร์ “${rec.game.title}” เข้าคลังเกมกลางใช่ไหม?\n\n` +
            'ทุกคนที่เข้าสู่ระบบจะเห็น เล่น และทำสำเนาไปแก้ได้ ฉบับในคลังจะไม่เปลี่ยนตามที่คุณแก้ภายหลัง (กด “อัปเดตในคลัง” เมื่ออยากให้เปลี่ยน)\n\n' +
            'ตรวจก่อนว่าไม่มีข้อมูลลูกค้า ราคา หรือข้อมูลลับของบริษัท',
        );
    if (ok) void act(`share:${rec.id}`, async () => (await cloud.share(rec.id), again ? 'อัปเดตฉบับในคลังกลางแล้ว' : 'แชร์เข้าคลังกลางแล้ว'));
  };

  const withdraw = (entryId: string, title: string) => {
    if (!confirm(`ถอน “${title}” ออกจากคลังกลางใช่ไหม? สำเนาที่คนอื่นทำไปแล้วจะยังอยู่กับเขา`)) return;
    void act(`withdraw:${entryId}`, async () => (await cloud.withdraw(entryId), 'ถอนออกจากคลังกลางแล้ว'));
  };

  const remove = (rec: GameRecord) => {
    const shared = rec.sharedEntryId ? '\n\nฉบับที่แชร์ไว้ในคลังกลางจะยังอยู่ ถ้าไม่อยากให้อยู่ กด “ถอนออก” ก่อน' : '';
    if (!confirm(`ลบเกม “${rec.game.title || 'ไม่มีชื่อ'}” ใช่ไหม? ลบแล้วกู้คืนไม่ได้${shared}`)) return;
    void act(`remove:${rec.id}`, async () => void (await cloud.remove(rec.id)));
  };

  const copyEntry = (entry: CatalogEntry) =>
    act(`copy:${entry.id}`, async () => {
      const copy = await cloud.copyEntry(entry.id);
      router.push(`/editor?id=${copy.id}`);
    });

  const busy = !!starting || !!working;

  return (
    <>
      <MoveBrowserGames user={user} onMoved={load} say={say} />

      <Section title="เกมของฉัน" note={`เก็บไว้ในบัญชีของ ${user.name} คนอื่นมองไม่เห็นจนกว่าคุณจะแชร์`}>
        {loadError ? (
          <LoadFailed message={loadError} onRetry={load} />
        ) : games === null ? null : games.length === 0 ? (
          <EmptyMine />
        ) : (
          games.map((rec, i) => {
            const ready = validateGame(dropBlankOptions(rec.game)).ok;
            return (
              <GameCard
                key={rec.id}
                game={rec.game}
                index={i}
                tag={
                  rec.tainted
                    ? '🔒 ข้อมูลภายใน'
                    : rec.sharedStatus === 'hidden' || rec.held
                      ? '🚩 รอตรวจ'
                      : rec.sharedStatus === 'listed'
                        ? '🌐 แชร์แล้ว'
                        : undefined
                }
                tagTone={rec.sharedStatus === 'hidden' || rec.held ? 'bad' : 'light'}
                busy={starting === rec.id}
                locked={busy}
                onStart={onStart}
                fixHref={ready ? null : `/editor?id=${rec.id}`}
                footer={
                  <ShareRow
                    rec={rec}
                    ready={ready}
                    disabled={busy}
                    working={working === `share:${rec.id}` || working === `withdraw:${rec.sharedEntryId}`}
                    onShare={() => share(rec)}
                    onWithdraw={() => rec.sharedEntryId && withdraw(rec.sharedEntryId, rec.game.title)}
                  />
                }
              >
                {ready && <EditLink id={rec.id} />}
                <DeleteButton title={rec.game.title} disabled={busy} onClick={() => remove(rec)} />
              </GameCard>
            );
          })
        )}
      </Section>

      <Section title="คลังเกมกลาง" note="เกมตัวอย่างและเกมที่เพื่อนแชร์ไว้ เล่นได้ทันที หรือทำสำเนาไปแก้เป็นของคุณ">
        {SAMPLE_GAMES.map((g, i) => (
          <GameCard key={g.id} game={g} index={i + 2} tag="ตัวอย่าง" busy={starting === g.id} locked={busy} onStart={onStart}>
            <Link href={`/editor?id=${g.id}`} className="btn bg-slate-100 px-4 text-base text-ink">
              📄 ทำสำเนาไปแก้
            </Link>
          </GameCard>
        ))}
        {(entries ?? []).map((entry, i) => (
          <GameCard
            key={entry.id}
            game={entry.game}
            index={i + SAMPLE_GAMES.length + 2}
            tag={entry.status === 'hidden' ? '🚩 ถูกซ่อนรอตรวจ' : entry.mine ? 'ของฉัน' : undefined}
            tagTone={entry.status === 'hidden' ? 'bad' : 'light'}
            byline={`โดย ${entry.authorName}`}
            busy={starting === entry.id}
            locked={busy}
            onStart={onStart}
            footer={
              // a hidden entry stays until a curator decides; withdrawing it would not lift the takedown
              user.isCurator || (entry.mine && entry.status === 'listed') ? (
                <FooterButton disabled={busy} onClick={() => withdraw(entry.id, entry.title)}>
                  {working === `withdraw:${entry.id}` ? 'กำลังถอน…' : entry.mine ? 'ถอนออกจากคลัง' : 'ถอนออก (ผู้ดูแล)'}
                </FooterButton>
              ) : entry.mine ? (
                <span className="text-sm text-slate-500">มีคนรายงาน ซ่อนไว้รอผู้ดูแลตรวจ</span>
              ) : (
                <FooterButton disabled={busy} onClick={() => setReporting(entry)}>
                  {working === `report:${entry.id}` ? 'กำลังส่ง…' : '🚩 รายงาน'}
                </FooterButton>
              )
            }
          >
            {/* a hidden entry can not be copied until a curator decides; the author still has the game itself */}
            {entry.status === 'listed' && (
              <button type="button" disabled={busy} onClick={() => void copyEntry(entry)} className="btn bg-slate-100 px-4 text-base text-ink">
                {working === `copy:${entry.id}` ? 'กำลังทำสำเนา…' : '📄 ทำสำเนาไปแก้'}
              </button>
            )}
          </GameCard>
        ))}
      </Section>

      <AnimatePresence>
        {reporting && (
          <ReportDialog
            entry={reporting}
            onClose={() => setReporting(null)}
            onSend={(reason, note) => {
              const entry = reporting;
              setReporting(null);
              void act(`report:${entry.id}`, async () =>
                (await cloud.report(entry.id, reason, note)) ? 'ขอบคุณที่แจ้ง ซ่อนเกมนี้ไว้แล้วระหว่างรอตรวจ' : 'ขอบคุณที่แจ้ง ผู้ดูแลจะตรวจสอบ',
              );
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** Share / update / withdraw, under each of the user's own games. */
function ShareRow({
  rec,
  ready,
  disabled,
  working,
  onShare,
  onWithdraw,
}: {
  rec: GameRecord;
  ready: boolean;
  disabled: boolean;
  working: boolean;
  onShare: () => void;
  onWithdraw: () => void;
}) {
  if (working) return <span className="text-sm text-slate-500">กำลังดำเนินการ…</span>;
  if (rec.tainted) return <span className="text-sm text-slate-500">สร้างจากข้อมูลภายใน จึงแชร์เข้าคลังกลางไม่ได้</span>;
  // a takedown stays until a curator decides: withdrawing or sharing again would not lift it
  if (rec.sharedStatus === 'hidden') return <span className="text-sm text-slate-500">มีคนรายงาน ซ่อนไว้รอผู้ดูแลตรวจ</span>;
  if (rec.held && rec.sharedStatus !== 'listed') {
    return <span className="text-sm text-slate-500">เนื้อหามาจากเกมที่ถูกรายงาน แชร์ไม่ได้จนกว่าผู้ดูแลจะตรวจเสร็จ</span>;
  }
  if (rec.sharedStatus === 'listed') {
    return (
      <>
        {!rec.held && (
          <FooterButton disabled={disabled || !ready} onClick={onShare}>
            🔄 อัปเดตในคลัง
          </FooterButton>
        )}
        <FooterButton disabled={disabled} onClick={onWithdraw}>
          ถอนออก
        </FooterButton>
      </>
    );
  }
  return ready ? (
    <FooterButton disabled={disabled} onClick={onShare}>
      🌐 แชร์เข้าคลังกลาง
    </FooterButton>
  ) : (
    <span className="text-sm text-slate-500">แก้ให้ครบก่อน จึงจะแชร์ได้</span>
  );
}

/** Games made before logging in sit in this browser; one click moves them into the account. */
function MoveBrowserGames({ user, onMoved, say }: { user: AccountUser; onMoved: () => Promise<void>; say: (text: string, tone?: 'bad' | 'good') => void }) {
  const [local, setLocal] = useState<Game[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  /** games the server refused, with why: they open in the editor here to be fixed */
  const [stuck, setStuck] = useState<{ id: string; title: string; why: string }[]>([]);

  useEffect(() => setLocal(listMyGames()), []);
  if (local.length === 0) return null;

  // the server keys each move by the browser's id, so a retry after a failure never makes duplicates
  const movable = local.filter((g) => /^[\w-]{1,64}$/.test(g.id));

  // a game the server refuses (too big, a field too long) is skipped and stays in the browser;
  // anything else (offline, logged out) stops the move, and pressing again carries on
  const move = async () => {
    let moved = 0;
    let separate = 0;
    const skipped: { id: string; title: string; why: string }[] = [];
    let stopped: unknown = null;
    try {
      for (const [i, g] of movable.entries()) {
        setProgress(`กำลังย้าย ${i + 1}/${movable.length}`);
        try {
          if ((await cloud.importLocal(g.id, g)).separate) separate++;
        } catch (e) {
          if (e instanceof ApiError && [400, 413, 415].includes(e.status)) {
            skipped.push({ id: g.id, title: g.title.trim() || 'ไม่มีชื่อ', why: apiMessage(e) });
            continue;
          }
          stopped = e;
          break;
        }
        deleteMyGame(g.id);
        moved++;
      }
      setStuck(skipped);
      // an old tab kept editing a game after it was moved: that content was kept as another game
      const kept = separate ? ` (${separate} เกมมีเนื้อหาต่างจากที่ย้ายไว้ก่อน เลยเก็บเป็นอีกเกม ชื่อลงท้าย “จากเบราว์เซอร์”)` : '';
      if (stopped) {
        if (stopped instanceof ApiError && (stopped.code === 'login_required' || stopped.code === 'wrong_user')) void refreshAccount();
        say(`ย้ายได้ ${moved} จาก ${movable.length} เกม แล้วหยุด: ${apiMessage(stopped)} กด “ย้ายเข้าบัญชี” อีกครั้งเพื่อย้ายที่เหลือ${kept}`);
      } else if (skipped.length) {
        say(`ย้ายได้ ${moved} จาก ${movable.length} เกม อีก ${skipped.length} เกมย้ายไม่ได้ ยังอยู่ในเบราว์เซอร์นี้ ดูรายการด้านบน${kept}`);
      } else {
        say(`ย้าย ${moved} เกมเข้าบัญชีแล้ว${kept}`, 'good');
      }
    } finally {
      setProgress(null);
      setLocal(listMyGames());
      await onMoved();
    }
  };

  const stillStuck = stuck.filter((g) => local.some((l) => l.id === g.id));
  return (
    <>
      <Banner
        emoji="📦"
        text={`มี ${local.length} เกมที่บันทึกไว้ในเบราว์เซอร์นี้ ย้ายเข้าบัญชีของ ${user.name} เพื่อเปิดจากเครื่องไหนก็ได้`}
      >
        <button type="button" disabled={!!progress || movable.length === 0} onClick={() => void move()} className="btn btn-light px-4 text-base">
          {progress ?? 'ย้ายเข้าบัญชี'}
        </button>
      </Banner>
      {stillStuck.length > 0 && (
        <div role="status" className="glass mt-3 p-5 text-sm">
          <p className="font-semibold">ย้ายไม่ได้: เปิดแก้ในเบราว์เซอร์นี้ให้ผ่านก่อน แล้วกด “ย้ายเข้าบัญชี” อีกครั้ง</p>
          <ul className="mt-2 flex flex-col gap-1">
            {stillStuck.map((g) => (
              <li key={g.id}>
                <Link href={`/editor?id=${encodeURIComponent(g.id)}`} className="font-bold underline">
                  {g.title}
                </Link>{' '}
                <span className="text-white/80">{g.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'confidential', label: 'มีข้อมูลลับหรือข้อมูลลูกค้า', hint: 'เกมจะถูกซ่อนทันทีจนกว่าผู้ดูแลจะตรวจ' },
  { value: 'inappropriate', label: 'เนื้อหาไม่เหมาะสม', hint: 'ถ้ามีคนแจ้ง 3 คน เกมจะถูกซ่อนรอตรวจ' },
  { value: 'other', label: 'อื่นๆ', hint: 'บอกเราในช่องด้านล่าง' },
];

function ReportDialog({ entry, onClose, onSend }: { entry: CatalogEntry; onClose: () => void; onSend: (reason: ReportReason, note: string) => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        initial={{ y: 20, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, scale: 0.97 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason) onSend(reason, note.trim());
        }}
        // a white card on a dark page: light form controls, or unchecked radios look filled in
        className="card w-full max-w-md p-6 scheme-light"
      >
        <h2 id="report-title" className="text-xl font-bold">
          รายงานเกม “{entry.title}”
        </h2>
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="sr-only">เหตุผล</legend>
          {REASONS.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer gap-3 rounded-2xl border-2 px-4 py-3 ${reason === r.value ? 'border-brand bg-brand/5' : 'border-slate-200'}`}
            >
              <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="mt-1 accent-brand" />
              <span>
                <span className="block font-semibold">{r.label}</span>
                <span className="block text-sm text-slate-500">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="report-note" className="mt-4 block text-sm font-semibold text-slate-600">
          รายละเอียด (ไม่บังคับ)
        </label>
        <textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className="field mt-1 resize-none" />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn bg-slate-100 px-4 text-base text-ink">
            ยกเลิก
          </button>
          <button type="submit" disabled={!reason} className="btn bg-bad px-4 text-base text-white">
            ส่งรายงาน
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

function Banner({ emoji, text, children }: { emoji: string; text: string; children?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="glass mt-8 flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
    >
      <span className="text-3xl" aria-hidden>
        {emoji}
      </span>
      <p className="flex-1 font-semibold">{text}</p>
      {children}
    </motion.div>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-3 p-8 text-center sm:col-span-2 lg:col-span-3">
      <p className="font-semibold">{message}</p>
      <button type="button" onClick={onRetry} className="btn btn-light px-4 text-base">
        ลองใหม่
      </button>
    </div>
  );
}

function EditLink({ id }: { id: string }) {
  return (
    <Link href={`/editor?id=${id}`} className="btn bg-slate-100 px-4 text-base text-ink">
      ✏️ แก้ไข
    </Link>
  );
}

function DeleteButton({ title, disabled = false, onClick }: { title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="btn bg-slate-100 px-3 text-base text-bad" aria-label={`ลบ ${title}`}>
      🗑️
    </button>
  );
}

function FooterButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg px-1 text-sm font-semibold text-brand underline-offset-4 hover:underline disabled:opacity-45"
    >
      {children}
    </button>
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
  tag,
  tagTone = 'light',
  byline,
  busy,
  locked,
  onStart,
  fixHref = null,
  footer,
  children,
}: {
  game: Game;
  index: number;
  tag?: string;
  tagTone?: 'light' | 'bad';
  /** who made it, for shared games */
  byline?: string;
  busy: boolean;
  locked: boolean;
  onStart: (game: Game) => void;
  /** set when the game is incomplete: the main button leads to the editor instead of opening a room */
  fixHref?: string | null;
  /** a row of small actions under the buttons (sharing, reporting) */
  footer?: React.ReactNode;
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
      <div className={`relative flex h-24 items-end justify-between gap-2 overflow-hidden px-5 pb-3 ${ANSWER_BG[color]}`}>
        <AnswerShape index={color} className="absolute -top-6 -right-4 size-32 rotate-12 text-white/20" />
        <span className="relative shrink-0 rounded-full bg-black/20 px-3 py-1 text-sm font-semibold text-white">
          {game.rounds.length} ด่าน · {countQuestions(game)} ข้อ
        </span>
        <span className="relative flex flex-wrap justify-end gap-1">
          {tag && <span className={`rounded-full px-3 py-1 text-xs font-bold ${tagTone === 'bad' ? 'bg-bad text-white' : 'bg-white text-ink'}`}>{tag}</span>}
          {fixHref && <span className="rounded-full bg-gold px-3 py-1 text-xs font-bold text-ink">⚠️ ยังไม่ครบ</span>}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-2 text-xl font-bold">{game.title || 'เกมไม่มีชื่อ'}</h3>
        {byline && <p className="mt-0.5 truncate text-sm font-semibold text-slate-500">{byline}</p>}
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
        {footer && <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3">{footer}</div>}
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
      <p className="max-w-md text-white/65">สร้างเกมแรกได้ในไม่กี่นาที หรือทำสำเนาเกมตัวอย่างไปแก้ต่อ</p>
      <Link href="/editor" className="btn btn-primary mt-2">
        ＋ สร้างเกมแรก
      </Link>
    </motion.div>
  );
}
