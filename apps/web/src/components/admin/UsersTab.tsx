'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshAccount, type AccountUser, type Perm, type Role } from '@/lib/account';
import {
  PERMS,
  PERM_LABEL,
  ROLE_LABEL,
  ROLE_TEXT,
  createUser,
  endSessions,
  listUsers,
  resetPassword,
  updateUser,
  type AdminUser,
  type LoginWays,
  type UserPatch,
} from '@/lib/admin';
import { ApiError, apiMessage } from '@/lib/api';
import { WaitingDots } from '../motion-bits';
import { Badge, Field, OneTimeSecret, Say, Sheet, Switch, fullTime, inputClass, num, timeAgo, type Tone } from './ui';

const ROLES: Role[] = ['maker', 'curator', 'admin'];
const ROLE_TONE: Record<Role, Tone> = { maker: 'neutral', curator: 'accent', admin: 'gold' };

const FIELD_ERRORS: Record<string, string> = {
  username: 'ชื่อผู้ใช้ไม่ถูกต้อง',
  name: 'ใส่ชื่อที่แสดง 2–40 ตัวอักษร',
  email: 'บัญชีที่เข้าด้วยบัญชีบริษัทอย่างเดียวต้องมีอีเมล',
  role: 'เลือกบทบาท',
};

/** the field a refusal is about, so the form can mark it */
function fieldOf(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'bad_field' && typeof e.data.field === 'string') return e.data.field;
  if (e.code === 'username_taken' || e.code === 'bad_username') return 'username';
  if (e.code === 'bad_name') return 'name';
  if (e.code === 'bad_email' || e.code === 'email_taken') return 'email';
  return null;
}

const errorText = (e: unknown) => (e instanceof ApiError && e.code === 'bad_field' && typeof e.data.field === 'string' ? (FIELD_ERRORS[e.data.field] ?? apiMessage(e)) : apiMessage(e));

/** a site that offers neither way (a test site on mock login): there is nothing to warn about */
const offersLogin = (ways: LoginWays | null): ways is LoginWays => !!ways && (ways.passwords || ways.company);

/** How this account gets in, counting only the ways this site offers now. */
function loginText(u: AdminUser, ways: LoginWays | null) {
  if (u.kind === 'mock') return 'บัญชีทดสอบ';
  if (u.kind === 'sso') return 'บัญชีบริษัท';
  const real = offersLogin(ways);
  const password = u.hasPassword && (!real || ways.passwords);
  const company = !!u.email && (!real || ways.company);
  return password && company ? 'รหัสผ่าน หรือบัญชีบริษัท' : password ? 'รหัสผ่าน' : company ? 'บัญชีบริษัทเท่านั้น' : 'ยังเข้าไม่ได้';
}

/** Why this (enabled) account can't log in on this site as it is set up now; null when it can. */
function stuckText(u: AdminUser, ways: LoginWays | null): string | null {
  if (!offersLogin(ways) || u.disabled || u.kind === 'mock') return null;
  if (u.kind === 'sso') return ways.company ? null : 'บัญชีนี้เข้าด้วยบัญชีบริษัท แต่ตอนนี้เว็บยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วยบัญชีบริษัท (Keycloak) จึงยังเข้าไม่ได้';
  if ((ways.passwords && u.hasPassword) || (ways.company && u.email)) return null;
  if (!ways.passwords) return 'เว็บนี้เข้าสู่ระบบด้วยบัญชีบริษัทอย่างเดียว ใส่อีเมลบริษัทของเจ้าของบัญชีด้านล่าง แล้วเจ้าของบัญชีจะเข้าได้';
  return 'บัญชีนี้ไม่มีรหัสผ่าน และเว็บยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วยบัญชีบริษัท (Keycloak) จึงยังเข้าไม่ได้ กด “ออกรหัสผ่านให้” ด้านล่างถ้าต้องการให้เข้าได้ตอนนี้';
}

export function UsersTab({ me }: { me: AccountUser }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<{ users: AdminUser[]; total: number; matched: number } | 'loading' | { error: string }>('loading');
  // how people log in here, from the last list that came back (kept when a later load fails)
  const [ways, setWays] = useState<LoginWays | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // search as the admin types, a moment after they stop
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Only the list asked for last is shown: an answer for an older search (or a reload started before the
  // search changed) that comes back late is dropped instead of replacing the list.
  const latest = useRef(0);
  const queryNow = useRef('');
  const load = useCallback(async (search: string) => {
    const n = ++latest.current;
    try {
      const { login, ...d } = await listUsers(search);
      if (n === latest.current) {
        setData(d);
        setWays(login);
      }
    } catch (e) {
      if (n === latest.current) setData({ error: apiMessage(e) });
    }
  }, []);

  useEffect(() => {
    queryNow.current = query;
    void load(query);
  }, [query, load]);

  const replaced = (u: AdminUser) => {
    setData((d) => (typeof d === 'object' && 'users' in d ? { ...d, users: d.users.map((x) => (x.id === u.id ? u : x)) } : d));
    setEditing((cur) => (cur && cur.id === u.id ? u : cur));
    // my own permissions changed: the rest of the site should know at once
    if (u.id === me.id) void refreshAccount();
  };

  return (
    <section aria-label="ผู้ใช้">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="admin-search" className="sr-only">
            ค้นหาผู้ใช้
          </label>
          <div className="relative">
            <svg viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ex-soft" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.5 13.5L17 17" />
            </svg>
            <input
              id="admin-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ ชื่อผู้ใช้ หรืออีเมล"
              className={`${inputClass} pl-10`}
              data-testid="admin-search"
              autoComplete="off"
            />
          </div>
        </div>
        <button type="button" className="exam-btn exam-btn-primary" disabled={!ways} onClick={() => setAdding(true)} data-testid="admin-add-user">
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
          เพิ่มผู้ใช้
        </button>
      </div>

      {flash && (
        <div className="mt-4">
          <Say tone="good">{flash}</Say>
        </div>
      )}

      <div className="mt-4">
        {data === 'loading' ? (
          <p className="exam-card flex items-center gap-3 p-6 text-ex-muted">
            กำลังโหลดรายชื่อ <WaitingDots />
          </p>
        ) : 'error' in data ? (
          <div className="exam-card p-6">
            <Say tone="bad">{data.error}</Say>
            <button type="button" className="exam-btn mt-4" onClick={() => void load(query)}>
              ลองใหม่
            </button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-ex-soft" data-testid="admin-user-count">
              {query ? `พบ ${num(data.matched)} จากทั้งหมด ${num(data.total)} บัญชี` : `ทั้งหมด ${num(data.total)} บัญชี`}
              {data.matched > data.users.length && ` · แสดง ${num(data.users.length)} บัญชีล่าสุด พิมพ์ค้นหาเพื่อหาบัญชีอื่น`}
            </p>
            {data.users.length === 0 ? (
              <p className="exam-card p-6 text-ex-muted">ไม่พบบัญชีที่ตรงกับ “{query}”</p>
            ) : (
              <ul className="exam-card divide-y divide-ex-line overflow-hidden" data-testid="admin-user-list">
                {data.users.map((u) => (
                  <UserRow key={u.id} u={u} me={u.id === me.id} stuck={stuckText(u, ways) !== null} onOpen={() => setEditing(u)} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {editing && <EditUser u={editing} me={editing.id === me.id} ways={ways} onClose={() => setEditing(null)} onSaved={replaced} />}
      {adding && ways && (
        <AddUser
          ways={ways}
          onClose={() => setAdding(false)}
          onMade={(u) => {
            setFlash(`สร้างบัญชี “${u.name}” แล้ว`);
            void load(queryNow.current);
          }}
        />
      )}
    </section>
  );
}

function UserRow({ u, me, stuck, onOpen }: { u: AdminUser; me: boolean; stuck: boolean; onOpen: () => void }) {
  const off = PERMS.filter((p) => !u.can[p]);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="admin-user-row"
        data-user={u.username ?? u.id}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-ex-raised sm:gap-4 sm:px-5"
      >
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full text-base font-bold ${u.disabled ? 'bg-white/10 text-ex-soft' : 'bg-brand-2 text-ink'}`}
          aria-hidden
        >
          {[...u.name][0]?.toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`font-semibold wrap-anywhere ${u.disabled ? 'text-ex-soft line-through' : ''}`}>{u.name}</span>
            {me && <Badge tone="accent">คุณ</Badge>}
            {u.role !== 'maker' && <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>}
            {u.disabled && <Badge tone="bad">ปิดใช้งาน</Badge>}
            {stuck && <Badge tone="gold">ยังเข้าไม่ได้</Badge>}
            {off.length > 0 && <Badge tone="neutral">ปิดสิทธิ์ {off.length} อย่าง</Badge>}
          </span>
          <span className="mt-0.5 block truncate text-sm text-ex-soft">
            {[u.username, u.email].filter(Boolean).join(' · ') || '—'}
          </span>
        </span>
        <span className="hidden shrink-0 text-right text-sm text-ex-soft sm:block">
          <span className="block">{u.lastLoginAt ? `เข้าล่าสุด ${timeAgo(u.lastLoginAt)}` : 'ยังไม่เคยเข้าใช้'}</span>
          <span className="block">{num(u.games)} เกม</span>
        </span>
        <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-ex-soft" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 3l5 5-5 5" />
        </svg>
      </button>
    </li>
  );
}

function EditUser({ u, me, ways, onClose, onSaved }: { u: AdminUser; me: boolean; ways: LoginWays | null; onClose: () => void; onSaved: (u: AdminUser) => void }) {
  const local = u.kind === 'local';
  const stuck = stuckText(u, ways);
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState(u.email ?? '');
  const [role, setRole] = useState<Role>(u.role);
  const [can, setCan] = useState(u.can);
  const [disabled, setDisabled] = useState(u.disabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [ask, setAsk] = useState<'password' | 'sessions' | null>(null);

  const patch: UserPatch = {};
  if (local && name.trim() !== u.name) patch.name = name;
  if (local && email.trim().toLowerCase() !== (u.email ?? '')) patch.email = email.trim() || null;
  if (role !== u.role) patch.role = role;
  const canDiff = PERMS.filter((p) => can[p] !== u.can[p]);
  if (canDiff.length) patch.can = Object.fromEntries(canDiff.map((p) => [p, can[p]])) as Partial<Record<Perm, boolean>>;
  if (disabled !== u.disabled) patch.disabled = disabled;
  const dirty = Object.keys(patch).length > 0;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setDone(null);
    try {
      await fn();
    } catch (e) {
      setError({ text: errorText(e), field: fieldOf(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      const r = await updateUser(u.id, patch);
      onSaved(r.user);
      setName(r.user.name);
      setEmail(r.user.email ?? '');
      setRole(r.user.role);
      setCan(r.user.can);
      setDisabled(r.user.disabled);
      setDone(patch.disabled ? 'บันทึกแล้ว บัญชีนี้ถูกปิดและออกจากระบบทุกเครื่องแล้ว' : 'บันทึกแล้ว');
    });

  const reset = () =>
    run('password', async () => {
      const r = await resetPassword(u.id);
      setAsk(null);
      setPassword(r.password);
      onSaved(r.user);
    });

  const signOut = () =>
    run('sessions', async () => {
      const r = await endSessions(u.id);
      setAsk(null);
      setDone(r.ended ? `ออกจากระบบแล้ว ${r.ended} เครื่อง` : 'บัญชีนี้ไม่ได้เข้าสู่ระบบค้างไว้ที่ไหน');
    });

  return (
    <Sheet title={u.name} onClose={onClose} locked={busy !== null} testid="admin-edit-user">
      <div className="grid gap-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-ex-line bg-night/40 p-4 text-sm">
          <div className="min-w-0">
            <dt className="text-ex-soft">ชื่อผู้ใช้</dt>
            <dd className="mt-0.5 truncate font-semibold">{u.username ?? '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ex-soft">วิธีเข้าสู่ระบบ</dt>
            <dd className="mt-0.5 font-semibold" data-testid="edit-login-ways">
              {loginText(u, ways)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ex-soft">เข้าใช้ล่าสุด</dt>
            <dd className="mt-0.5 font-semibold" title={u.lastLoginAt ? fullTime(u.lastLoginAt) : undefined}>
              {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'ยังไม่เคย'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ex-soft">เกมในบัญชี</dt>
            <dd className="mt-0.5 font-semibold">{num(u.games)} เกม</dd>
          </div>
        </dl>

        {stuck && (
          <div data-testid="edit-stuck">
            <Say tone="gold">{stuck}</Say>
          </div>
        )}

        {local ? (
          <div className="grid gap-4">
            <Field label="ชื่อที่แสดง" error={error?.field === 'name' ? error.text : null}>
              {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={60} data-testid="edit-name" />}
            </Field>
            <Field
              label="อีเมลบริษัท"
              error={error?.field === 'email' ? error.text : null}
              hint={
                ways && !ways.passwords
                  ? 'ใช้เข้าสู่ระบบด้วยบัญชีบริษัท (เว็บนี้ไม่มีรหัสผ่าน) และตั้งชื่อคลังความรู้ Pika ของคนนี้'
                  : 'ใช้เข้าสู่ระบบด้วยบัญชีบริษัท และตั้งชื่อคลังความรู้ Pika ของคนนี้ เว้นว่างได้ถ้าใช้รหัสผ่าน'
              }
            >
              {(id) => (
                <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@mfec.co.th" autoComplete="off" data-testid="edit-email" />
              )}
            </Field>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-ex-soft">ชื่อและอีเมลของบัญชีนี้มาจากระบบบริษัท จึงแก้ที่นี่ไม่ได้</p>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ex-muted">บทบาท</legend>
          <div className="grid gap-2" role="radiogroup">
            {ROLES.map((r) => {
              const locked = me && u.role === 'admin' && r !== 'admin';
              return (
                <label
                  key={r}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    role === r ? 'border-ex-accent bg-ex-accent/10' : 'border-ex-line hover:border-ex-line-strong'
                  } ${locked ? 'cursor-not-allowed opacity-45' : ''}`}
                >
                  <input type="radio" name="role" value={r} checked={role === r} disabled={locked} onChange={() => setRole(r)} className="mt-1 accent-[#93a3ff]" data-testid={`edit-role-${r}`} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{ROLE_LABEL[r]}</span>
                    <span className="block text-sm leading-relaxed text-ex-soft">{ROLE_TEXT[r]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {me && u.role === 'admin' && <p className="mt-2 text-sm text-ex-soft">ลดบทบาทของตัวเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นทำแทน</p>}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-ex-muted">สิทธิ์ใช้งาน</legend>
          <div className="divide-y divide-ex-line">
            {PERMS.map((p) => (
              <Switch key={p} checked={can[p]} onChange={(on) => setCan((c) => ({ ...c, [p]: on }))} title={PERM_LABEL[p].title} text={PERM_LABEL[p].text} testid={`edit-perm-${p}`} />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-ex-muted">สถานะบัญชี</legend>
          <Switch
            checked={!disabled}
            onChange={(on) => setDisabled(!on)}
            disabled={me}
            title={disabled ? 'ปิดใช้งานอยู่' : 'เปิดใช้งาน'}
            text={me ? 'ปิดบัญชีของตัวเองไม่ได้' : 'ปิดแล้วเข้าสู่ระบบไม่ได้ และออกจากระบบทุกเครื่องทันที เกมในบัญชียังอยู่ครบ เปิดคืนได้ทุกเมื่อ'}
            testid="edit-enabled"
          />
        </fieldset>

        {password && (
          <OneTimeSecret
            label="รหัสผ่านใหม่"
            value={password}
            note="ส่งให้เจ้าของบัญชีทางช่องทางที่ปลอดภัย รหัสนี้จะแสดงครั้งเดียว ปิดหน้าต่างนี้แล้วดูอีกไม่ได้ บัญชีนี้ถูกออกจากระบบทุกเครื่องแล้ว"
          />
        )}

        {error && !error.field && <Say tone="bad">{error.text}</Say>}
        {done && <Say tone="good">{done}</Say>}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="exam-btn exam-btn-primary flex-1 sm:flex-none" disabled={!dirty || busy !== null} onClick={() => void save()} data-testid="edit-save">
            {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          <button type="button" className="exam-btn" disabled={busy !== null} onClick={onClose}>
            {dirty ? 'ยกเลิก' : 'ปิด'}
          </button>
        </div>

        <div className="grid gap-3 border-t border-ex-line pt-5">
          <h3 className="text-sm font-semibold text-ex-muted">เครื่องมือเพิ่มเติม</h3>
          {ask ? (
            <div className="rounded-xl border border-ex-line-strong bg-night/40 p-4">
              <p className="text-sm leading-relaxed">
                {ask === 'password'
                  ? `ตั้งรหัสผ่านใหม่ให้ “${u.name}”? รหัสเดิมจะใช้ไม่ได้ทันที และบัญชีจะถูกออกจากระบบทุกเครื่อง`
                  : `ให้ “${u.name}” ออกจากระบบทุกเครื่องเลยไหม? เจ้าของบัญชีต้องเข้าสู่ระบบใหม่`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="exam-btn exam-btn-primary"
                  disabled={busy !== null}
                  onClick={() => void (ask === 'password' ? reset() : signOut())}
                  data-testid="confirm-action"
                >
                  {busy === 'password' || busy === 'sessions' ? 'กำลังดำเนินการ…' : 'ยืนยัน'}
                </button>
                <button type="button" className="exam-btn" disabled={busy !== null} onClick={() => setAsk(null)}>
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {local && ways?.passwords && (
                <button type="button" className="exam-btn text-sm" disabled={busy !== null} onClick={() => setAsk('password')} data-testid="reset-password">
                  {u.hasPassword ? 'ตั้งรหัสผ่านใหม่' : 'ออกรหัสผ่านให้'}
                </button>
              )}
              <button type="button" className="exam-btn text-sm" disabled={busy !== null} onClick={() => setAsk('sessions')} data-testid="end-sessions">
                ออกจากระบบทุกเครื่อง
              </button>
            </div>
          )}
          <p className="text-xs text-ex-soft">สร้างบัญชีเมื่อ {fullTime(u.createdAt)}</p>
        </div>
      </div>
    </Sheet>
  );
}

function AddUser({ ways, onClose, onMade }: { ways: LoginWays; onClose: () => void; onMade: (u: AdminUser) => void }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // a password is only offered where the site has a password form
  const [how, setHow] = useState<'generate' | 'none'>(ways.passwords ? 'generate' : 'none');
  const companyNote = ways.company ? 'ไม่มีรหัสผ่าน เข้าด้วยอีเมลบริษัท' : 'ไม่มีรหัสผ่าน เข้าได้เมื่อตั้งค่าการเข้าสู่ระบบด้วยบัญชีบริษัทแล้ว';
  const choices = (
    [
      ['generate', 'รหัสผ่าน', 'ระบบสร้างรหัสให้ แสดงครั้งเดียวหลังบันทึก'],
      ['none', 'บัญชีบริษัทเท่านั้น', companyNote],
    ] as const
  ).filter(([v]) => v !== 'generate' || ways.passwords);
  const [role, setRole] = useState<Role>('maker');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null);
  const [made, setMade] = useState<{ user: AdminUser; password: string | null } | null>(null);

  // the username most people would pick: the part of the email before the @
  const fromEmail = (v: string) => {
    if (!username || username === guessFrom(email)) setUsername(guessFrom(v));
    setEmail(v);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createUser({ username, name, email, password: how, role });
      setMade(r);
      onMade(r.user);
    } catch (e2) {
      setError({ text: errorText(e2), field: fieldOf(e2) });
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    return (
      <Sheet title="สร้างบัญชีแล้ว" onClose={onClose} testid="admin-user-made">
        <div className="grid gap-4">
          <p className="leading-relaxed">
            บัญชี <span className="font-semibold">“{made.user.name}”</span> (ชื่อผู้ใช้ <span className="font-mono">{made.user.username}</span>) พร้อมใช้งาน
          </p>
          {made.password ? (
            <OneTimeSecret
              label="รหัสผ่านเริ่มต้น"
              value={made.password}
              note="ส่งชื่อผู้ใช้และรหัสนี้ให้เจ้าของบัญชีทางช่องทางที่ปลอดภัย รหัสจะแสดงครั้งเดียว ปิดหน้าต่างนี้แล้วดูอีกไม่ได้ (ออกรหัสใหม่ได้ภายหลัง)"
            />
          ) : ways.company ? (
            <Say tone="good">เจ้าของบัญชีเข้าสู่ระบบได้ด้วยปุ่ม “เข้าสู่ระบบด้วยบัญชีบริษัท” โดยใช้อีเมล {made.user.email}</Say>
          ) : (
            <Say tone="gold">
              บัญชีนี้ยังเข้าสู่ระบบไม่ได้ เพราะเว็บยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วยบัญชีบริษัท (Keycloak) เมื่อตั้งค่าแล้วเจ้าของบัญชีจะเข้าได้ด้วยอีเมล {made.user.email}
              {ways.passwords && ' หรือเปิดบัญชีนี้แล้วกด “ออกรหัสผ่านให้” เพื่อให้เข้าได้ตอนนี้'}
            </Say>
          )}
          <button type="button" className="exam-btn exam-btn-primary" onClick={onClose} data-testid="made-close">
            เสร็จแล้ว
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="เพิ่มผู้ใช้" onClose={onClose} locked={busy} testid="admin-add-sheet">
      <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <Field label="อีเมลบริษัท" error={error?.field === 'email' ? error.text : null} hint={how === 'none' ? 'จำเป็น: ใช้อีเมลนี้เข้าสู่ระบบด้วยบัญชีบริษัท' : 'ไม่บังคับ แต่ต้องมีถ้าจะใช้คลังความรู้ Pika หรือเข้าด้วยบัญชีบริษัท'}>
          {(id) => (
            <input id={id} type="email" value={email} onChange={(e) => fromEmail(e.target.value)} className={inputClass} placeholder="name@mfec.co.th" autoComplete="off" data-testid="add-email" />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ชื่อผู้ใช้" error={error?.field === 'username' ? error.text : null} hint="a–z, 0–9, จุด, ขีด · 3–32 ตัว">
            {(id) => (
              <input
                id={id}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                className={`${inputClass} font-mono`}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                data-testid="add-username"
              />
            )}
          </Field>
          <Field label="ชื่อที่แสดง" error={error?.field === 'name' ? error.text : null} hint="ผู้เล่นเห็นชื่อนี้">
            {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required maxLength={60} data-testid="add-name" />}
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ex-muted">วิธีเข้าสู่ระบบ</legend>
          <div className={`grid gap-2 ${choices.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {choices.map(([v, t, d]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${how === v ? 'border-ex-accent bg-ex-accent/10' : 'border-ex-line hover:border-ex-line-strong'}`}>
                <input type="radio" name="how" checked={how === v} onChange={() => setHow(v)} className="mt-1 accent-[#93a3ff]" data-testid={`add-how-${v}`} />
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-ex-soft">{d}</span>
                </span>
              </label>
            ))}
          </div>
          {!ways.passwords && <p className="mt-2 text-sm text-ex-soft">เว็บนี้เข้าสู่ระบบด้วยบัญชีบริษัทอย่างเดียว จึงไม่มีตัวเลือกรหัสผ่าน</p>}
          {how === 'none' && !ways.company && (
            <div className="mt-3" data-testid="add-company-off">
              <Say tone="gold">
                เว็บยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วยบัญชีบริษัท (Keycloak) บัญชีแบบนี้จะยังเข้าไม่ได้จนกว่าจะตั้งค่า
                {ways.passwords && ' ถ้าเจ้าของบัญชีต้องใช้ตอนนี้ เลือก “รหัสผ่าน” แทน'}
              </Say>
            </div>
          )}
        </fieldset>

        <Field label="บทบาท" hint={ROLE_TEXT[role]}>
          {(id) => (
            <select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass} data-testid="add-role">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
        </Field>

        {error && !error.field && <Say tone="bad">{error.text}</Say>}

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className="exam-btn exam-btn-primary flex-1 sm:flex-none" disabled={busy} data-testid="add-submit">
            {busy ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
          </button>
          <button type="button" className="exam-btn" disabled={busy} onClick={onClose}>
            ยกเลิก
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const guessFrom = (email: string) =>
  (email.trim().toLowerCase().split('@')[0] ?? '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .slice(0, 32);
