import type { Metadata } from 'next';
import { LoginScreen } from '@/components/LoginScreen';
import { safeNext } from '@/lib/cloud';

export const metadata: Metadata = { title: 'เข้าสู่ระบบ' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginScreen next={safeNext(next)} />;
}
