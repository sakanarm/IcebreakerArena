'use client';

import { useId, useState } from 'react';
import { COVER_ARTS, COVER_COLORS, coverColor, isCoverEmoji, type CoverColor, type Game, type GameCover as Cover } from '@icebreaker/shared';
import { GameCover } from '../cover/GameCover';
import { ART_NAMES, COVER_SHADES, SUGGESTED_EMOJIS } from '../cover/palette';
import type { Edit } from './model';

const swatch = (c: CoverColor) => ({ background: `linear-gradient(135deg, ${COVER_SHADES[c].bg[0]}, ${COVER_SHADES[c].bg[1]})` });

/** The cover: one of our drawings, or a pattern that comes from the title, in a color and with an emoji. */
export function CoverPicker({ game, edit }: { game: Game; edit: Edit }) {
  const ids = useId();
  const { art, color, emoji } = game.cover ?? {};
  // an emoji typed in the box rather than picked from the row
  const custom = emoji && !SUGGESTED_EMOJIS.includes(emoji) ? emoji : '';
  // the box's text while typing; null shows the saved emoji
  const [typed, setTyped] = useState<string | null>(null);
  const typedBad = typed !== null && typed.trim() !== '' && !isCoverEmoji(typed.trim());

  const set = (patch: Partial<Cover>) =>
    edit((d) => {
      const next: Cover = { ...d.cover, ...patch };
      for (const k of Object.keys(next) as (keyof Cover)[]) if (next[k] === undefined) delete next[k];
      if (Object.keys(next).length > 0) d.cover = next;
      else delete d.cover;
    });

  const pickEmoji = (e: string | undefined) => {
    setTyped(null);
    set({ emoji: e });
  };

  const type = (v: string) => {
    setTyped(v);
    const e = v.trim();
    if (isCoverEmoji(e)) set({ emoji: e });
    else if (e === '' && custom) set({ emoji: undefined });
  };

  return (
    <section aria-labelledby={`${ids}-h`}>
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-x-2">
        <h3 id={`${ids}-h`} className="font-display font-semibold">
          หน้าปก
        </h3>
        <span className="text-xs text-slate-400">โชว์ในรายการเกมและบนจอตอนรอผู้เล่น</span>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="self-start overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-slate-200" aria-hidden>
          <div className="relative aspect-[16/7]">
            <GameCover game={game} className="absolute inset-0 size-full" />
          </div>
          <p className="truncate px-3 py-2 font-display font-semibold">{game.title.trim() || 'เกมไม่มีชื่อ'}</p>
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <p id={`${ids}-art`} className="mb-1.5 text-sm font-semibold text-slate-600">
              ลาย
            </p>
            <div role="radiogroup" aria-labelledby={`${ids}-art`} className="grid grid-cols-3 gap-x-2 gap-y-3">
              <ArtOption on={!art} label="ลายจากชื่อเกม" onPick={() => set({ art: undefined })}>
                <GameCover game={{ title: game.title, cover: { color, emoji } }} />
              </ArtOption>
              {COVER_ARTS.map((a) => (
                <ArtOption key={a} on={art === a} label={ART_NAMES[a]} onPick={() => set({ art: a })}>
                  <GameCover game={{ title: game.title, cover: { art: a } }} />
                </ArtOption>
              ))}
            </div>
          </div>

          {/* a drawing comes with its own colors and pictures */}
          {!art && (
            <>
              <div>
                <p id={`${ids}-color`} className="mb-1.5 text-sm font-semibold text-slate-600">
                  สี
                </p>
                <div role="radiogroup" aria-labelledby={`${ids}-color`} className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!color}
                    onClick={() => set({ color: undefined })}
                    className={`flex h-9 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-semibold transition-colors ${!color ? 'bg-ink text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    <span className="size-7 rounded-full" style={swatch(coverColor({ title: game.title }))} aria-hidden />
                    อัตโนมัติ
                  </button>
                  {COVER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c}
                      aria-label={COVER_SHADES[c].name}
                      title={COVER_SHADES[c].name}
                      onClick={() => set({ color: c })}
                      style={swatch(c)}
                      className={`grid size-9 place-items-center rounded-full text-sm font-bold text-white ring-ink ring-offset-2 transition-transform motion-safe:hover:scale-110 ${color === c ? 'ring-[3px]' : ''}`}
                    >
                      {color === c && <span aria-hidden>✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p id={`${ids}-emoji`} className="mb-1.5 text-sm font-semibold text-slate-600">
                  อีโมจิ
                </p>
                <div role="radiogroup" aria-labelledby={`${ids}-emoji`} className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!emoji}
                    onClick={() => pickEmoji(undefined)}
                    className={`h-10 rounded-xl px-3 text-sm font-semibold transition-colors ${!emoji ? 'bg-ink text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    ไม่มี
                  </button>
                  {SUGGESTED_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="radio"
                      aria-checked={emoji === e}
                      aria-label={e}
                      onClick={() => pickEmoji(e)}
                      className={`grid size-10 place-items-center rounded-xl text-2xl transition-colors ${emoji === e ? 'bg-white ring-[3px] ring-ink' : 'bg-slate-100 hover:bg-slate-200'}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <input
                    value={typed ?? custom}
                    onChange={(e) => type(e.target.value)}
                    onBlur={() => setTyped(null)}
                    maxLength={24}
                    placeholder="พิมพ์เอง"
                    aria-label="อีโมจิอื่น พิมพ์เอง 1 ตัว"
                    aria-invalid={typedBad}
                    aria-describedby={`${ids}-emoji-hint`}
                    className={`field w-28 py-2 text-center text-xl ${typedBad ? 'border-bad' : custom ? 'border-ink' : ''}`}
                  />
                  <span id={`${ids}-emoji-hint`} className={`text-sm ${typedBad ? 'font-semibold text-bad' : 'text-slate-500'}`}>
                    {typedBad ? 'ใส่ได้ทีละ 1 อีโมจิเท่านั้น' : 'หรือใส่อีโมจิอื่นได้ 1 ตัว'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ArtOption({ on, label, onPick, children }: { on: boolean; label: string; onPick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className="group/art min-w-0 text-left">
      <span
        className={`relative block aspect-video overflow-hidden rounded-xl transition-shadow ${on ? 'ring-[3px] ring-brand ring-offset-2' : 'ring-1 ring-slate-200 group-hover/art:ring-2 group-hover/art:ring-slate-400'}`}
      >
        {children}
        {on && (
          <span className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-brand text-xs font-bold text-white shadow" aria-hidden>
            ✓
          </span>
        )}
      </span>
      <span className={`mt-1 block truncate text-xs ${on ? 'font-semibold text-ink' : 'text-slate-500'}`}>{label}</span>
    </button>
  );
}
