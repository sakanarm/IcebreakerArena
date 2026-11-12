'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { localLogin, logout, mockLogin, refreshAccount, ssoStartPath, switchSsoAccount, useAccount } from '@/lib/account';
import { apiMessage } from '@/lib/api';
import { withBase } from '@/lib/paths';
import { WaitingDots } from './motion-bits';
import { Notice } from './Notice';

/** Why a company login came back here (the ?error= the server sets). Anything else in the address is ignored. */
const SSO_MESSAGES: Record<string, string> = {
  no_account: 'บัญชีบริษัทนี้ยังเข้าใช้ไม่ได้ อีเมลของบัญชีนี้ซ้ำกับบัญชีอื่นในระบบ ติดต่อผู้ดูแลระบบให้ตรวจก่อน แล้วค่อยเข้าสู่ระบบอีกครั้ง',
  account_disabled: 'บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบ',
  sso_cancelled: 'ยกเลิกการเข้าสู่ระบบแล้ว กดปุ่มอีกครั้งเมื่อพร้อม',
  sso_expired: 'การเข้าสู่ระบบหมดเวลา หรือเริ่มไว้จากอีกแท็บ กดเข้าสู่ระบบใหม่อีกครั้ง',
  sso_failed: 'เข้าสู่ระบบด้วยบัญชีบริษัทไม่สำเร็จ ลองใหม่อีกครั้ง ถ้ายังไม่ได้ ติดต่อผู้ดูแลระบบ',
};

/** Four squares, the usual mark on a "sign in with your Microsoft work account" button. */
function WorkAccountMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0">
      <rect x="1" y="1" width="8.5" height="8.5" fill="#f25022" />
      <rect x="10.5" y="1" width="8.5" height="8.5" fill="#7fba00" />
      <rect x="1" y="10.5" width="8.5" height="8.5" fill="#00a4ef" />
      <rect x="10.5" y="10.5" width="8.5" height="8.5" fill="#ffb900" />
    </svg>
  );
}

/**
 * Login for game makers. Players never log in: they join with a PIN and a nickname. While company login is on,
 * it is the only way shown; the username form (for accounts an admin made with a password, and for tests) is
 * still there at /login?with=password.
 */
export function LoginScreen({ next, error: returned = null, withPassword = false }: { next: string; error?: string | null; withPassword?: boolean }) {
  const router = useRouter();
  const account = useAccount();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // on the way to Microsoft; reset when the browser's Back brings this page back from its cache
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const back = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);
  const ssoProblem = returned ? SSO_MESSAGES[returned] ?? null : null;

  if (account.status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center text-xl">
        <span className="flex items-center gap-3">
          กำลังโหลด <WaitingDots />
        </span>
      </div>
    );
  }

  if (account.status === 'error') {
    return (
      <Notice
        emoji="📡"
        title="เชื่อมต่อไม่ได้"
        actions={
          <button type="button" onClick={() => void refreshAccount()} className="btn btn-primary">
            ลองใหม่
          </button>
        }
      >
        ตรวจว่าเครื่องนี้ต่อ Wi-Fi บริษัทหรือ VPN อยู่ แล้วลองใหม่
      </Notice>
    );
  }

  if (account.mode === 'off') {
    return (
      <Notice
        emoji="🧊"
        title="ยังไม่ต้องเข้าสู่ระบบ"
        actions={
          <Link href="/host" className="btn btn-primary">
            ไปหน้าจัดเกม
          </Link>
        }
      >
        ตอนนี้เกมที่สร้างจะบันทึกไว้ในเบราว์เซอร์ของเครื่องนี้ ใช้งานได้เลยโดยไม่ต้องมีบัญชี
      </Notice>
    );
  }

  if (account.user && !account.switched) {
    return (
      <Notice
        emoji="👋"
        title={`สวัสดี ${account.user.name}`}
        actions={
          <>
            <Link href={next} className="btn btn-primary">
              ไปต่อ →
            </Link>
            {/* e.g. back here from a page that still works for another account */}
            <button
              type="button"
              onClick={() => logout().catch((e: unknown) => setError(apiMessage(e)))}
              className="btn btn-ghost"
            >
              ไม่ใช่ {account.user.name}? ออกจากระบบ
            </button>
          </>
        }
      >
        คุณเข้าสู่ระบบอยู่แล้ว
        {error && (
          <span role="alert" className="mt-2 block text-sm font-semibold text-bad">
            {error}
          </span>
        )}
      </Notice>
    );
  }

  const otherAccount = async () => {
    setError(null);
    try {
      const url = await switchSsoAccount();
      window.location.assign(url ?? withBase('/login'));
    } catch (e) {
      setError(apiMessage(e));
    }
  };

  // Company login: a plain link, since the server answers with a redirect to Keycloak
  const companyLogin = account.sso && (
    <div className="flex flex-col gap-3">
      {ssoProblem && (
        <div role="alert" className="rounded-xl bg-bad/15 px-4 py-3 text-left text-sm font-semibold text-bad">
          {ssoProblem}
          {returned === 'no_account' && (
            <span className="mt-1 block font-normal text-white/80">
              ถ้าจะเข้าร่วมเล่นเกม ไม่ต้องเข้าสู่ระบบ{' '}
              <Link href="/play" className="font-semibold underline">
                ไปหน้าเข้าร่วมเกม
              </Link>
            </span>
          )}
        </div>
      )}
      <a
        href={withBase(ssoStartPath(next))}
        onClick={() => setLeaving(true)}
        aria-disabled={leaving}
        className={`btn btn-primary flex items-center justify-center gap-3 ${leaving ? 'pointer-events-none opacity-70' : ''}`}
      >
        <WorkAccountMark />
        {leaving ? 'กำลังไปหน้า Microsoft…' : 'เข้าสู่ระบบด้วยบัญชีบริษัท'}
      </a>
      {(returned === 'no_account' || returned === 'account_disabled') && (
        <button type="button" onClick={() => void otherAccount()} className="text-sm font-semibold text-white/70 underline hover:text-white">
          ใช้บัญชี Microsoft อื่น
        </button>
      )}
    </div>
  );

  if (account.mode === 'oidc' || (account.mode === 'local' && companyLogin && !withPassword)) {
    if (!companyLogin) {
      return (
        <Notice emoji="🔧" title="ระบบเข้าสู่ระบบยังไม่พร้อม">
          การเข้าสู่ระบบด้วยบัญชีบริษัทยังตั้งค่าไม่เสร็จ ติดต่อผู้ดูแลระบบ
        </Notice>
      );
    }
    return (
      <Notice emoji="🔑" title="เข้าสู่ระบบ">
        <p className="mb-5">สำหรับคนสร้างและจัดเกม ใช้บัญชี Microsoft ของบริษัท ส่วนคนเล่นเข้าร่วมด้วย PIN ได้เลยโดยไม่ต้องเข้าสู่ระบบ</p>
        {companyLogin}
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-bad">
            {error}
          </p>
        )}
      </Notice>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (account.mode === 'local') await localLogin(name, password);
      else await mockLogin(name);
      router.replace(next);
    } catch (err) {
      setError(apiMessage(err));
      setPassword('');
      setBusy(false);
    }
  };

  if (account.mode === 'local') {
    return (
      <Notice emoji="🔑" title="เข้าสู่ระบบ">
        {companyLogin ? (
          <>
            <p className="mb-5">สำหรับคนสร้างและจัดเกม ใช้บัญชี Microsoft ของบริษัท ส่วนคนเล่นเข้าร่วมด้วย PIN ได้เลยโดยไม่ต้องเข้าสู่ระบบ</p>
            {companyLogin}
            <p className="mt-6 flex items-center gap-3 text-sm text-white/60" aria-hidden="true">
              <span className="h-px flex-1 bg-white/20" />
              หรือใช้ชื่อผู้ใช้ที่ผู้ดูแลระบบให้ไว้
              <span className="h-px flex-1 bg-white/20" />
            </p>
          </>
        ) : (
          <p>ใช้ชื่อผู้ใช้และรหัสผ่านที่ผู้ดูแลระบบให้ไว้</p>
        )}
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3 text-left">
          <label htmlFor="login-user" className="text-sm font-semibold text-white/80">
            ชื่อผู้ใช้
          </label>
          <input
            id="login-user"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={!companyLogin}
            className="field font-display text-lg"
          />
          <label htmlFor="login-password" className="mt-1 text-sm font-semibold text-white/80">
            รหัสผ่าน
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={200}
            autoComplete="current-password"
            className="field font-display text-lg"
          />
          {error && (
            <p role="alert" className="text-sm font-semibold text-bad">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || name.trim().length < 3 || !password} className="btn btn-primary mt-1">
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </Notice>
    );
  }

  return (
    <Notice emoji="🔑" title="เข้าสู่ระบบ">
      <span className="mb-3 inline-block rounded-full bg-gold px-3 py-1 text-sm font-bold text-ink">โหมดทดสอบ</span>
      <p>ใส่ชื่ออะไรก็ได้ ไม่มีรหัสผ่าน ใช้ทดสอบบนเครื่องนักพัฒนาเท่านั้น ชื่อเดิมจะได้บัญชีเดิม</p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 text-left">
        <label htmlFor="login-name" className="text-sm font-semibold text-white/80">
          ชื่อที่จะแสดง
        </label>
        <input
          id="login-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="nickname"
          autoFocus
          placeholder="เช่น สมชาย"
          className="field font-display text-lg"
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-bad">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || name.trim().length < 2} className="btn btn-primary mt-1">
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </Notice>
  );
}
