import type { Metadata, Viewport } from 'next';
import { ExamApp } from '@/components/exam/ExamApp';

export const metadata: Metadata = { title: 'ข้อสอบ' };
export const viewport: Viewport = { themeColor: '#0b0b2b' };

export default async function ExamPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ExamApp code={code} />;
}
