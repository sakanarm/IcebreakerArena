import type { Metadata } from 'next';
import { PikaApp } from '@/components/pika/PikaApp';

export const metadata: Metadata = { title: 'ข้อสอบจากคลังความรู้' };

export default function PikaPage() {
  return <PikaApp />;
}
