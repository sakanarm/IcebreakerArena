import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice } from '@/components/Notice';

export const metadata: Metadata = { title: 'ไม่พบหน้านี้' };

export default function NotFound() {
  return (
    <Notice
      emoji="🧭"
      title="ไม่พบหน้านี้"
      actions={
        <>
          <Link href="/play" className="btn btn-primary">
            ใส่ PIN เข้าเกม
          </Link>
          <Link href="/" className="btn btn-ghost">
            กลับหน้าแรก
          </Link>
        </>
      }
    >
      ลิงก์อาจพิมพ์ผิด หรือห้องเกมนั้นปิดไปแล้ว
    </Notice>
  );
}
