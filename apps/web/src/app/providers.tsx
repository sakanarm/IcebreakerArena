'use client';

import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { warmFonts } from '@/lib/fonts';

/** Honors the OS "reduce motion" setting: movement is dropped, fades stay. */
export function Providers({ children }: { children: React.ReactNode }) {
  // once per visit: the layout stays as the app moves from page to page
  useEffect(warmFonts, []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
