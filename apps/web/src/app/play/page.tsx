import type { Metadata } from 'next';
import { PlayerApp } from '@/components/player/PlayerApp';

export const metadata: Metadata = { title: 'เข้าเกม' };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ pin?: string | string[] }> }) {
  const { pin } = await searchParams;
  const initialPin = typeof pin === 'string' && /^\d{6}$/.test(pin) ? pin : null;
  return <PlayerApp key={initialPin ?? 'no-pin'} initialPin={initialPin} />;
}
