import type { Metadata, Viewport } from 'next';
import { AdminApp } from '@/components/admin/AdminApp';

export const metadata: Metadata = { title: 'ตั้งค่าระบบ', robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: '#0b0b2b' };

/** /admin: users, roles and permissions, the AI connection, and the site's state. The API checks the admin role on every call. */
export default function AdminPage() {
  return <AdminApp />;
}
