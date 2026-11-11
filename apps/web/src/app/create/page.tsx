import type { Metadata } from 'next';
import { CreateApp } from '@/components/create/CreateApp';

export const metadata: Metadata = { title: 'สร้างข้อสอบใหม่' };

export default function CreatePage() {
  return <CreateApp />;
}
