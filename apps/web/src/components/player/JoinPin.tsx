'use client';

import { motion, useAnimate } from 'motion/react';
import { useState } from 'react';
import { FloatingShapes, Logo } from '../shapes';

export function JoinPin({ onSubmit, error }: { onSubmit: (pin: string) => Promise<boolean>; error: string | null }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, animate] = useAnimate<HTMLFormElement>();

  const shake = () => void animate(scope.current, { x: [0, -14, 14, -10, 10, -4, 0] }, { duration: 0.45 });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) return shake();
    setBusy(true);
    const ok = await onSubmit(pin);
    setBusy(false);
    if (!ok) shake();
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-8 px-5 py-10">
      <FloatingShapes opacity={0.12} />
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="relative">
        <Logo />
      </motion.div>
      <motion.form
        ref={scope}
        onSubmit={submit}
        initial={{ y: 30, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="card relative w-full max-w-sm p-6"
      >
        <label htmlFor="pin" className="block text-center font-display text-xl font-semibold">
          ใส่ PIN เกม
        </label>
        <input
          id="pin"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="PIN 6 หลัก"
          aria-invalid={!!error}
          aria-describedby={error ? 'pin-error' : undefined}
          className="field mt-4 text-center font-display text-4xl font-extrabold tracking-[0.3em] placeholder:text-xl placeholder:font-normal placeholder:tracking-normal"
          autoFocus
        />
        {error && (
          <motion.p id="pin-error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 text-center text-bad" role="alert">
            {error}
          </motion.p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary mt-4 w-full py-4 text-xl">
          {busy ? 'กำลังตรวจ…' : 'เข้าเกม'}
        </button>
      </motion.form>
      <p className="relative text-center text-sm text-white/55">ดู PIN 6 หลักบนจอใหญ่ หรือสแกน QR Code ด้วยกล้องมือถือ</p>
    </div>
  );
}
