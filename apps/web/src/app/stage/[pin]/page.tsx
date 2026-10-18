import type { Metadata } from 'next';
import { StageScreen } from '@/components/stage/StageScreen';

export const metadata: Metadata = { title: 'จอใหญ่' };

export default async function StagePage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  return <StageScreen pin={pin} />;
}
