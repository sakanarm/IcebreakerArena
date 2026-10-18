import type { Metadata } from 'next';
import { HostScreen } from '@/components/host/HostScreen';

export const metadata: Metadata = { title: 'คุมเกม' };

export default async function HostRoomPage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  return <HostScreen pin={pin} />;
}
