import type { Metadata } from 'next';
import { GamePicker } from '@/components/host/GamePicker';

export const metadata: Metadata = { title: 'เลือกเกม' };

export default function HostPage() {
  return <GamePicker />;
}
