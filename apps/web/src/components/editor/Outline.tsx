'use client';

import { Reorder, useDragControls } from 'motion/react';
import { LIMITS, type Game, type Question } from '@icebreaker/shared';
import { TYPE_ICON } from '@/lib/format';
import { blankQuestion, blankRound, countQuestions } from '@/lib/games';
import { ANSWER_BG } from '../shapes';
import { issuesAt, type Edit, type Selection } from './model';

/** The game at a glance, like a slide list: rounds, their questions, and what still needs work. */
export function Outline({
  game,
  sel,
  errors,
  edit,
  onSelect,
}: {
  game: Game;
  sel: Selection;
  errors: string[];
  edit: Edit;
  onSelect: (sel: Selection) => void;
}) {
  const full = countQuestions(game) >= LIMITS.questionsMax;

  const addRound = () => {
    const r = blankRound(game.rounds.length + 1);
    edit((d) => void d.rounds.push(r));
    onSelect({ kind: 'round', id: r.id });
  };

  const addQuestion = (ri: number) => {
    const q = blankQuestion();
    edit((d) => void d.rounds[ri].questions.push(q));
    onSelect({ kind: 'question', id: q.id });
  };

  const reorder = (ri: number, ids: string[]) =>
    edit((d) => {
      const byId = new Map(d.rounds[ri].questions.map((q) => [q.id, q]));
      d.rounds[ri].questions = ids.flatMap((id) => byId.get(id) ?? []);
    });

  return (
    <nav aria-label="โครงเกม" className="space-y-3">
      <button
        type="button"
        onClick={() => onSelect({ kind: 'game' })}
        aria-current={sel.kind === 'game'}
        className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left font-semibold transition-colors ${sel.kind === 'game' ? 'bg-white text-ink' : 'bg-white/5 hover:bg-white/10'}`}
      >
        <span aria-hidden>⚙️</span> ตั้งค่าเกม
      </button>

      {game.rounds.map((r, ri) => {
        const roundActive = sel.kind === 'round' && sel.id === r.id;
        const roundWarn = issuesAt(errors, ri).length > 0;
        return (
          <section key={r.id} className="rounded-2xl bg-white/5 p-2">
            <button
              type="button"
              onClick={() => onSelect({ kind: 'round', id: r.id })}
              aria-current={roundActive}
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors ${roundActive ? 'bg-white text-ink' : 'hover:bg-white/10'}`}
            >
              <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-sm font-bold text-white ${ANSWER_BG[ri % 4]}`}>{ri + 1}</span>
              <span className="min-w-0 flex-1 truncate font-display font-semibold">{r.title || `ด่าน ${ri + 1}`}</span>
              {(r.multiplier ?? 1) > 1 && <span className="rounded-full bg-gold px-2 text-xs font-bold text-ink">×{r.multiplier}</span>}
              {roundWarn && <WarnDot />}
            </button>

            <Reorder.Group as="ol" axis="y" values={r.questions.map((q) => q.id)} onReorder={(ids) => reorder(ri, ids)} className="mt-1 space-y-0.5">
              {r.questions.map((q, qi) => (
                <OutlineQuestion
                  key={q.id}
                  question={q}
                  number={qi + 1}
                  active={sel.kind === 'question' && sel.id === q.id}
                  warn={issuesAt(errors, ri, qi).length > 0}
                  onSelect={() => onSelect({ kind: 'question', id: q.id })}
                />
              ))}
            </Reorder.Group>

            <button
              type="button"
              onClick={() => addQuestion(ri)}
              disabled={full}
              className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              ＋ เพิ่มคำถาม
            </button>
          </section>
        );
      })}

      <button
        type="button"
        onClick={addRound}
        disabled={game.rounds.length >= LIMITS.roundsMax || full}
        className="w-full rounded-2xl border-2 border-dashed border-white/20 px-3 py-3 font-semibold text-white/70 transition-colors hover:border-brand-2 hover:text-white disabled:opacity-40"
      >
        ＋ เพิ่มด่าน
      </button>
    </nav>
  );
}

function OutlineQuestion({
  question: q,
  number,
  active,
  warn,
  onSelect,
}: {
  question: Question;
  number: number;
  active: boolean;
  warn: boolean;
  onSelect: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item as="li" value={q.id} dragListener={false} dragControls={controls} className="relative">
      <div className={`flex items-center rounded-xl transition-colors ${active ? 'bg-white text-ink shadow-lg' : 'hover:bg-white/10'}`}>
        {/* drag handle; keyboard users reorder with the ↑ ↓ buttons in the question panel */}
        <span aria-hidden onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none px-2 py-2 text-sm opacity-35 select-none active:cursor-grabbing">
          ⋮⋮
        </span>
        <button type="button" onClick={onSelect} aria-current={active} className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left">
          <span className="w-5 shrink-0 text-xs tabular-nums opacity-60">{number}</span>
          <span aria-hidden className="text-sm">
            {TYPE_ICON[q.type]}
          </span>
          <span className={`min-w-0 flex-1 truncate text-sm ${q.prompt.trim() ? '' : 'italic opacity-50'}`}>{q.prompt.trim() || 'ยังไม่มีคำถาม'}</span>
          {warn && <WarnDot />}
        </button>
      </div>
    </Reorder.Item>
  );
}

function WarnDot() {
  return <span className="size-2.5 shrink-0 rounded-full bg-gold ring-2 ring-gold/30" title="ยังไม่ครบ" aria-label="ยังไม่ครบ" role="img" />;
}
