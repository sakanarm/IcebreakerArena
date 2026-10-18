'use client';

import { MotionConfig } from 'motion/react';

/** Honors the OS "reduce motion" setting: movement is dropped, fades stay. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
