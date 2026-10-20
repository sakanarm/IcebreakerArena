'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localLogin, logout, mockLogin, refreshAccount, useAccount } from '@/lib/account';
import { apiMessage } from '@/lib/api';
import { WaitingDots } from './motion-bits';
import { Notice } from './Notice';

/** Login for game makers. Players never log in: they join with a PIN and a nickname. */
export function LoginScreen({ next }: { next: string }) {
  const router = useRouter();
  const account = useAccount();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (account.mode === 'oidc') {
    // company login (Microsoft Entra ID) is the next step; until IT registers the app there is nothing to send people to
    return (
      <Notice emoji="🔧" title="ระบบเข้าสู่ระบบยังไม่พร้อม">
        การเข้าสู่ระบบด้วยบัญชีบริษัทยังตั้งค่าไม่เสร็จ ติดต่อผู้ดูแลระบบ
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
        <p>ใช้ชื่อผู้ใช้และรหัสผ่านที่ผู้ดูแลระบบให้ไว้</p>
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
            autoFocus
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
