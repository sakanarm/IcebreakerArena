'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { BASE_PATH } from '@/lib/paths';
import { WaitingDots } from './motion-bits';
import { FloatingShapes } from './shapes';

/** A centered message card: room closed, not allowed, kicked, and so on. */
export function Notice({
  emoji,
  title,
  children,
  actions,
}: {
  emoji: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-dvh place-items-center p-6">
      <FloatingShapes />
      <motion.div
        initial={{ y: 30, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="glass relative w-full max-w-md p-8 text-center"
      >
        <motion.div
          className="text-6xl"
          animate={{ rotate: [0, -8, 8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        >
          {emoji}
        </motion.div>
        <h1 className="mt-4 text-3xl font-extrabold">{title}</h1>
        {children && <div className="mt-3 text-white/75">{children}</div>}
        {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
      </motion.div>
    </div>
  );
}

/** Shown while the socket connects; after a while it explains the usual causes. */
export function Connecting({ label = 'กำลังเชื่อมต่อ' }: { label?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative grid min-h-dvh place-items-center p-6 text-center">
      <FloatingShapes />
      <div className="relative">
        <p className="flex items-center justify-center gap-3 text-2xl font-semibold">
          {label} <WaitingDots />
        </p>
        {slow && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 max-w-sm text-white/65">
            {/* behind the company proxy, a phone that dropped to mobile data can no longer reach the site */}
            {BASE_PATH
              ? 'ถ้ารอนานเกินไป ลองรีเฟรชหน้านี้ และตรวจว่าเครื่องนี้ต่อ Wi-Fi ของบริษัทหรือ VPN อยู่'
              : 'ถ้ารอนานเกินไป ตรวจว่าเกมเซิร์ฟเวอร์ (พอร์ต 4000) ทำงานอยู่ และเครื่องนี้อยู่ในเครือข่ายเดียวกับเครื่องที่รันเกม'}
          </motion.p>
        )}
      </div>
    </div>
  );
}
