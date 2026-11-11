import type { Metadata } from 'next';
import { ImportApp } from '@/components/import/ImportApp';

export const metadata: Metadata = { title: 'นำเข้าคลังข้อสอบ' };

export default function ImportPage() {
  return <ImportApp />;
}
