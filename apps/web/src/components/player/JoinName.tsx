'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AVATARS, NICKNAME_MAX, cleanNickname, randomAvatar, randomNickname } from '@icebreaker/shared';
import { keys, load, type Profile } from '@/lib/storage';
import { FloatingShapes } from '../shapes';

export function JoinName({
  title,
  pin,
  busy,
  error,
  onSubmit,
}: {
  title: string;
  pin: string;
  busy: boolean;
  error: string | null;
  onSubmit: (nickname: string, avatar: string) => void;
}) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [rolls, setRolls] = useState(0);

  // last time's name and avatar, or a fun random one (picked after mount, so the server render stays stable)
  useEffect(() => {
    const saved = load<Profile | null>(keys.profile, null);
    setName(saved?.nickname || randomNickname());
    setAvatar(saved && (AVATARS as readonly string[]).includes(saved.avatar) ? saved.avatar : randomAvatar());
  }, []);

  const roll = () => {
    setName(randomNickname());
    setRolls((n) => n + 1);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(cleanNickname(name) || randomNickname(), avatar);
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-8">
      <FloatingShapes opacity={0.1} />
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mb-4 max-w-sm text-center text-white/75">
        กำลังเข้าห้อง <span className="font-semibold text-white">{title || `PIN ${pin}`}</span>
      </motion.p>

      <motion.form
        onSubmit={submit}
        initial={{ y: 30, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="card relative w-full max-w-sm p-6"
      >
        <div className="flex flex-col items-center">
          <motion.div
            key={avatar}
            initial={{ scale: 0.4, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 14 }}
            className="grid size-24 place-items-center rounded-full bg-slate-100 text-6xl shadow-inner"
            aria-hidden
          >
            <span className="animate-bob inline-block">{avatar}</span>
          </motion.div>
        </div>

        <label htmlFor="nickname" className="mt-5 block font-display text-lg font-semibold">
          ชื่อเล่นในเกม
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            enterKeyHint="go"
            className="field text-lg font-semibold"
          />
          <button type="button" onClick={roll} className="btn btn-light shrink-0 px-4 text-2xl ring-2 ring-slate-200" aria-label="สุ่มชื่อใหม่" title="สุ่มชื่อใหม่">
            <motion.span key={rolls} initial={{ rotate: -360, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
              🎲
            </motion.span>
          </button>
        </div>

        <p className="mt-5 font-display text-lg font-semibold">เลือกตัวละคร</p>
        <div className="mt-2 grid grid-cols-5 gap-2" role="radiogroup" aria-label="ตัวละคร">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={a === avatar}
              onClick={() => setAvatar(a)}
              className="relative grid aspect-square place-items-center rounded-2xl text-3xl transition-transform active:scale-90"
            >
              {a === avatar && (
                <motion.span layoutId="avatar-pick" className="absolute inset-0 rounded-2xl bg-brand/15 ring-3 ring-brand" transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
              )}
              <span className="relative">{a}</span>
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-4 text-center text-bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary mt-5 w-full py-4 text-xl">
          {busy ? 'กำลังเข้าห้อง…' : 'ไปเลย! 🚀'}
        </button>
      </motion.form>
    </div>
  );
}
