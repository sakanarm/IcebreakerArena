import type { Metadata } from 'next';
import { LoginScreen } from '@/components/LoginScreen';
import { safeNext } from '@/lib/cloud';

export const metadata: Metadata = { title: 'เข้าสู่ระบบ' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[]; with?: string | string[] }>;
}) {
  const { next, error, with: how } = await searchParams;
  // error: the reason a company login came back (no_account, sso_failed…); LoginScreen shows only the ones it knows.
  // with=password: the username form, which is not shown while company login is on (for admins and tests)
  return <LoginScreen next={safeNext(next)} error={typeof error === 'string' ? error : null} withPassword={how === 'password'} />;
}
