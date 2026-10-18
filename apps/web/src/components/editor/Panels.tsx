'use client';

import { motion } from 'motion/react';
import { LIMITS, type Game } from '@icebreaker/shared';
import { blankQuestion, countQuestions, estimateMinutes } from '@/lib/games';
import { ANSWER_BG } from '../shapes';
import type { Edit, Selection } from './model';
import { Counter, FieldLabel, IconButton, Issues, Segmented, Toggle } from './ui';

const DESCRIPTION_MAX = 300;

/** Name, description and scoring options for the whole game. */
export function GameSettings({ game, issues, edit, onDelete }: { game: Game; issues: string[]; edit: Edit; onDelete: (() => void) | null }) {
  const stats = [
    { label: 'ด่าน', value: game.rounds.length },
    { label: 'คำถาม', value: countQuestions(game) },
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
          <FieldLabel htmlFor="game-desc" extra={<Counter length={game.description?.length ?? 0} max={DESCRIPTION_MAX} />}>
            คำอธิบาย <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
          </FieldLabel>
          <textarea
            id="game-desc"
            value={game.description ?? ''}
            onChange={(e) => edit((d) => void (d.description = e.target.value))}
            maxLength={DESCRIPTION_MAX}
            rows={2}
            placeholder="เกมนี้เกี่ยวกับอะไร ใช้ในงานไหน"
            className="field resize-none"
          />
        </div>
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
        key={`${multiplier}-${timed}`}
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
          <span className="rounded-full bg-black/20 px-3 py-1">{round.questions.length} ข้อ</span>
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
        <Issues items={issues} />
        <button type="button" onClick={addQuestion} className="btn btn-primary w-full">
          ＋ เพิ่มคำถามในด่านนี้
        </button>
      </div>
    </div>
  );
}
