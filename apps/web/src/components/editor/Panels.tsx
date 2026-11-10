'use client';

import { motion } from 'motion/react';
import { useId, useState } from 'react';
import { LIMITS, askedCount, isBank, type Game, type Round } from '@pika-arena/shared';
import { blankQuestion, countAsked, countQuestions, estimateMinutes } from '@/lib/games';
import { ANSWER_BG } from '../shapes';
import { CoverPicker } from './CoverPicker';
import type { Edit, Selection } from './model';
import { Counter, FieldLabel, IconButton, Issues, Segmented, Toggle } from './ui';

/** Name, description, cover and scoring options for the whole game. */
export function GameSettings({ game, issues, edit, onDelete }: { game: Game; issues: string[]; edit: Edit; onDelete: (() => void) | null }) {
  const [asked, written] = [countAsked(game), countQuestions(game)];
  const stats = [
    { label: 'ด่าน', value: game.rounds.length },
    // with a question bank: what one room asks, out of what is written
    asked < written ? { label: `ข้อต่อรอบ จากคลัง ${written} ข้อ`, value: `🎲 ${asked}` } : { label: 'คำถาม', value: written },
    { label: 'นาทีโดยประมาณ', value: `~${estimateMinutes(game)}` },
  ];
  return (
    <div>
      <h2 className="text-2xl font-extrabold">ตั้งค่าเกม</h2>
      <div className="card mt-4 space-y-5 p-5 md:p-7">
        <div>
          <FieldLabel htmlFor="game-title" extra={<Counter length={game.title.length} max={LIMITS.titleMax} />}>
            ชื่อเกม
          </FieldLabel>
          <input
            id="game-title"
            value={game.title}
            onChange={(e) => edit((d) => void (d.title = e.target.value))}
            maxLength={LIMITS.titleMax}
            placeholder="เช่น Icebreaker ต้อนรับน้องใหม่ Q4"
            autoFocus={!game.title}
            className="field font-display text-xl font-semibold"
          />
        </div>
        <div>
          <FieldLabel htmlFor="game-desc" extra={<Counter length={game.description?.length ?? 0} max={LIMITS.descriptionMax} />}>
            คำอธิบาย <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
          </FieldLabel>
          <textarea
            id="game-desc"
            value={game.description ?? ''}
            onChange={(e) => edit((d) => void (d.description = e.target.value))}
            maxLength={LIMITS.descriptionMax}
            rows={2}
            placeholder="เกมนี้เกี่ยวกับอะไร ใช้ในงานไหน"
            className="field resize-none"
          />
        </div>
        <CoverPicker game={game} edit={edit} />
        <Toggle
          on={!!game.settings?.streakBonus}
          onChange={(on) => edit((d) => void (d.settings = { ...d.settings, streakBonus: on }))}
          label="🔥 โบนัสตอบถูกติดกัน"
          hint="ตอบถูกต่อเนื่องได้เพิ่ม +100 ต่อข้อ (สูงสุด +500)"
        />
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
              <div className="font-display text-2xl font-extrabold">{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
        <Issues items={issues} />
      </div>
      {onDelete && (
        <button type="button" onClick={onDelete} className="mt-6 text-sm text-white/50 underline-offset-4 hover:text-bad hover:underline">
          🗑 ลบเกมนี้
        </button>
      )}
    </div>
  );
}

/** One round: its name, its score multiplier and whether speed counts, with a preview of its intro. */
export function RoundEditor({
  game,
  ri,
  issues,
  edit,
  onSelect,
}: {
  game: Game;
  ri: number;
  issues: string[];
  edit: Edit;
  onSelect: (sel: Selection) => void;
}) {
  const round = game.rounds[ri];
  const total = game.rounds.length;
  const multiplier = round.multiplier ?? 1;
  const timed = round.timed !== false;
  const count = round.questions.length;
  const bank = isBank(round);
  const asked = askedCount(round);

  const move = (to: number) =>
    edit((d) => {
      [d.rounds[ri], d.rounds[to]] = [d.rounds[to], d.rounds[ri]];
    });

  const remove = () => {
    if (!confirm(`ลบ “${round.title || `ด่าน ${ri + 1}`}” และคำถามทั้ง ${round.questions.length} ข้อในด่านนี้ใช่ไหม?`)) return;
    const next = game.rounds[ri - 1] ?? game.rounds[ri + 1];
    edit((d) => void d.rounds.splice(ri, 1));
    onSelect(next ? { kind: 'round', id: next.id } : { kind: 'game' });
  };

  const addQuestion = () => {
    const q = blankQuestion();
    edit((d) => void d.rounds[ri].questions.push(q));
    onSelect({ kind: 'question', id: q.id });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold">
          ด่าน {ri + 1} <span className="text-base font-normal text-white/60">จาก {total}</span>
        </h2>
        <div className="flex gap-2 rounded-2xl bg-white p-1.5">
          <IconButton label="เลื่อนด่านขึ้น" onClick={() => move(ri - 1)} disabled={ri === 0}>
            ↑
          </IconButton>
          <IconButton label="เลื่อนด่านลง" onClick={() => move(ri + 1)} disabled={ri === total - 1}>
            ↓
          </IconButton>
          <IconButton label={total === 1 ? 'เกมต้องมีอย่างน้อย 1 ด่าน' : 'ลบด่าน'} onClick={remove} disabled={total === 1} danger>
            🗑
          </IconButton>
        </div>
      </div>

      {/* what the big screen shows when this round starts */}
      <motion.div
        key={`${multiplier}-${timed}-${bank}`}
        initial={{ scale: 0.97 }}
        animate={{ scale: 1 }}
        className={`relative mt-4 overflow-hidden rounded-3xl p-6 text-center shadow-xl ${ANSWER_BG[ri % 4]}`}
      >
        <span className="rounded-full bg-black/20 px-3 py-1 text-sm font-semibold">
          ด่าน {ri + 1} / {total}
        </span>
        <p className="mt-3 font-display text-3xl font-extrabold drop-shadow">{round.title || `ด่าน ${ri + 1}`}</p>
        {round.subtitle && <p className="mt-1 text-white/90">{round.subtitle}</p>}
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm">
          {multiplier > 1 && <span className="rounded-full bg-gold px-3 py-1 font-bold text-ink">คะแนน ×{multiplier}</span>}
          {!timed && <span className="rounded-full bg-black/20 px-3 py-1">⏱️ ไม่นับความเร็ว</span>}
          <span data-round-count className="rounded-full bg-black/20 px-3 py-1">
            {!bank ? `${count} ข้อ` : asked < count ? `🎲 สุ่ม ${asked} จาก ${count} ข้อ` : count > 1 ? `🎲 ${count} ข้อ สลับลำดับ` : `🎲 ${count} ข้อ`}
          </span>
        </div>
      </motion.div>

      <div className="card mt-4 space-y-5 p-5 md:p-7">
        <div>
          <FieldLabel htmlFor={`round-title-${round.id}`} extra={<Counter length={round.title.length} max={LIMITS.titleMax} />}>
            ชื่อด่าน
          </FieldLabel>
          <input
            id={`round-title-${round.id}`}
            value={round.title}
            onChange={(e) => edit((d) => void (d.rounds[ri].title = e.target.value))}
            maxLength={LIMITS.titleMax}
            placeholder="เช่น อุ่นเครื่อง, Tech Trivia, Final Round"
            className="field font-display text-lg font-semibold"
          />
        </div>
        <div>
          <FieldLabel htmlFor={`round-sub-${round.id}`}>
            คำโปรย <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
          </FieldLabel>
          <input
            id={`round-sub-${round.id}`}
            value={round.subtitle ?? ''}
            onChange={(e) => edit((d) => void (d.rounds[ri].subtitle = e.target.value))}
            maxLength={LIMITS.titleMax}
            placeholder="เช่น คะแนน ×2 ทุกข้อ พลิกเกมได้!"
            className="field"
          />
        </div>
        <div>
          <p className="mb-1.5 font-display font-semibold">ตัวคูณคะแนนของด่าน</p>
          <Segmented
            label="ตัวคูณคะแนนของด่าน"
            value={multiplier}
            options={[1, 2, 3, 4].map((m) => ({ value: m, label: `×${m}` }))}
            onChange={(m) => edit((d) => void (d.rounds[ri].multiplier = m))}
          />
          <p className="mt-1.5 text-sm text-slate-500">ด่านท้ายๆ ใช้ ×2 ช่วยให้คนที่ตามหลังมีโอกาสพลิกเกม</p>
        </div>
        <Toggle
          on={timed}
          onChange={(on) => edit((d) => void (d.rounds[ri].timed = on))}
          label="⚡ นับความเร็ว"
          hint={timed ? 'ตอบถูกเร็วได้แต้มมากกว่า (สูงสุด 1,000 ต่อข้อ)' : 'ตอบถูกได้ 1,000 เต็มทุกคน เหมาะกับคำถามที่ต้องใช้ความคิด'}
        />
        <BankControl
          round={round}
          onChange={(draw) =>
            edit((d) => {
              if (draw === null) delete d.rounds[ri].draw;
              else d.rounds[ri].draw = draw;
            })
          }
        />
        <Issues items={issues} />
        <button type="button" onClick={addQuestion} className="btn btn-primary w-full">
          ＋ เพิ่มคำถามในด่านนี้
        </button>
      </div>
    </div>
  );
}

/** what a bank starts at: 10 of a big one, half of a small one */
const firstDraw = (count: number) => Math.max(1, Math.min(10, Math.ceil(count / 2)));

/**
 * Makes the round a question bank: write many questions, and each room asks only some of them,
 * drawn at random. The number is held to what the round has, so it can always be played.
 */
function BankControl({ round, onChange }: { round: Round; onChange: (draw: number | null) => void }) {
  const id = useId();
  const count = round.questions.length;
  const bank = isBank(round);
  const asked = askedCount(round);
  // the box may hold half-typed text; undo and deleted questions change the number from outside
  const [text, setText] = useState(String(asked));
  const [seen, setSeen] = useState(asked);
  if (seen !== asked) {
    setSeen(asked);
    setText(String(asked));
  }
  const set = (n: number) => {
    const to = Math.max(1, Math.min(count, n));
    setSeen(to);
    setText(String(to));
    onChange(to);
  };

  return (
    <div>
      <Toggle
        on={bank}
        onChange={(on) => onChange(on ? firstDraw(count) : null)}
        label="🎲 สุ่มคำถามจากคลัง"
        hint={
          bank
            ? 'เปิดห้องแต่ละครั้ง ระบบสุ่มคำถามของด่านนี้มาถามใหม่ ไม่ซ้ำข้อ และสลับลำดับทุกครั้ง'
            : 'ใส่คำถามไว้เยอะ ๆ เป็นคลัง แล้วให้แต่ละรอบสุ่มมาถามแค่บางข้อ เล่นซ้ำก็ไม่เจอชุดเดิม'
        }
      />
      {bank && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} data-bank className="mt-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label htmlFor={id} className="font-display font-semibold">
              แต่ละรอบถาม
            </label>
            <div className="flex items-center gap-1.5">
              <IconButton label="ถามน้อยลง 1 ข้อ" onClick={() => set(asked - 1)} disabled={asked <= 1}>
                −
              </IconButton>
              <input
                id={id}
                inputMode="numeric"
                autoComplete="off"
                value={text}
                onChange={(e) => {
                  const t = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);
                  if (t === '' || Number(t) < 1) return setText(t);
                  set(Number(t));
                }}
                onBlur={() => setText(String(asked))}
                className="field w-20 px-2 text-center font-display text-xl font-bold tabular-nums"
              />
              <IconButton label="ถามเพิ่ม 1 ข้อ" onClick={() => set(asked + 1)} disabled={asked >= count}>
                ＋
              </IconButton>
            </div>
            <span className="text-slate-600">
              ข้อ จากทั้งหมด <b className="text-ink">{count}</b> ข้อในด่านนี้
            </span>
          </div>
          <p data-bank-note className="mt-2 text-sm text-slate-500">
            {asked < count
              ? `อีก ${count - asked} ข้อพักไว้รอบหน้า ทุกข้อมีโอกาสถูกสุ่มเท่ากัน คะแนนและรายงานนับเฉพาะข้อที่ถูกถาม`
              : count > 1
                ? `ตอนนี้ถามครบทั้ง ${count} ข้อ แค่สลับลำดับ ถ้าอยากให้แต่ละรอบได้ชุดต่างกัน เพิ่มคำถามในด่านนี้ หรือลดจำนวนที่ถาม`
                : 'ด่านนี้มีข้อเดียว เพิ่มคำถามเข้าคลังก่อน แล้วค่อยเลือกว่าจะสุ่มมาถามกี่ข้อ'}
          </p>
        </motion.div>
      )}
    </div>
  );
}
