'use client';

import { useEffect, useRef, useState } from 'react';
import { getAi, getOverview, saveAi, testAi, type AiSettings, type AiTestResult, type Effort, type Overview } from '@/lib/admin';
import { ApiError, apiMessage } from '@/lib/api';
import { WaitingDots } from '../motion-bits';
import { Badge, Field, Say, Switch, inputClass, num, type Tone } from './ui';

/** the same bounds the server checks (server/ai-settings.ts AI_LIMITS_ADMIN) */
const LIMITS = {
  maxTokens: [256, 16000],
  perPersonPerDay: [1, 10000],
  perDay: [1, 1000000],
  quizPerPersonPerDay: [1, 1000],
} as const;
type IntKey = keyof typeof LIMITS;
const INT_KEYS = Object.keys(LIMITS) as IntKey[];
const MAX_HEADERS = 10;

const EFFORT_LABEL: Record<Effort, string> = { low: 'ต่ำ (เร็ว ประหยัด)', medium: 'กลาง', high: 'สูง (คิดละเอียด ช้ากว่า)' };

const FIELD_TEXT: Record<string, string> = {
  baseUrl: 'ที่อยู่ต้องขึ้นต้นด้วย http:// หรือ https:// และไม่มีชื่อผู้ใช้ รหัสผ่าน ? หรือ #',
  apiKey: 'คีย์ต้องไม่มีช่องว่างหรือขึ้นบรรทัดใหม่',
  model: 'ชื่อโมเดลใช้ได้เฉพาะ a–z, 0–9 และ . _ : / @ -',
  headers: 'ตรวจ header: ชื่อใช้ a–z 0–9 และ - ห้ามซ้ำ ห้ามใช้ชื่อที่ระบบตั้งเอง และต้องมีค่า',
  maxTokens: `ใส่ ${LIMITS.maxTokens[0]}–${num(LIMITS.maxTokens[1])}`,
  perPersonPerDay: `ใส่ ${LIMITS.perPersonPerDay[0]}–${num(LIMITS.perPersonPerDay[1])}`,
  perDay: `ใส่ ${LIMITS.perDay[0]}–${num(LIMITS.perDay[1])}`,
  quizPerPersonPerDay: `ใส่ ${LIMITS.quizPerPersonPerDay[0]}–${num(LIMITS.quizPerPersonPerDay[1])}`,
};

interface Header {
  key: number;
  name: string;
  value: string;
  /** the name the server has a value for, when this row came from the server; an empty box keeps that value while the name is unchanged */
  orig: string | null;
}

interface Form {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  clearKey: boolean;
  model: string;
  effort: Effort;
  quizEffort: Effort;
  fallbacks: boolean;
  structuredOutput: boolean;
  who: 'anyone' | 'signed-in';
  ints: Record<IntKey, string>;
  headers: Header[];
}

let headerKey = 0;

const kept = (h: Header) => h.orig !== null && h.name.trim() === h.orig;

const formOf = (s: AiSettings): Form => ({
  enabled: s.enabled,
  baseUrl: s.baseUrl ?? '',
  apiKey: '',
  clearKey: false,
  model: s.model,
  effort: s.effort,
  quizEffort: s.quizEffort,
  fallbacks: s.fallbacks,
  structuredOutput: s.structuredOutput,
  who: s.who,
  ints: Object.fromEntries(INT_KEYS.map((k) => [k, String(s[k])])) as Record<IntKey, string>,
  headers: s.headerNames.map((name) => ({ key: ++headerKey, name, value: '', orig: name })),
});

/** what changed, as the server takes it; field errors found before sending */
function diff(s: AiSettings, f: Form): { body: Record<string, unknown>; errors: Record<string, string> } {
  const body: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  if (f.enabled !== s.enabled) body.enabled = f.enabled;
  if (f.fallbacks !== s.fallbacks) body.fallbacks = f.fallbacks;
  if (f.structuredOutput !== s.structuredOutput) body.structuredOutput = f.structuredOutput;
  if (f.effort !== s.effort) body.effort = f.effort;
  if (f.quizEffort !== s.quizEffort) body.quizEffort = f.quizEffort;
  if (f.who !== s.who) body.who = f.who;
  if (f.model.trim() !== s.model) {
    body.model = f.model.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/.test(f.model.trim())) errors.model = FIELD_TEXT.model;
  }
  if (f.baseUrl.trim().replace(/\/+$/, '') !== (s.baseUrl ?? '')) {
    const v = f.baseUrl.trim();
    body.baseUrl = v || null;
    if (v && !/^https?:\/\/[^\s?#@]+$/i.test(v)) errors.baseUrl = FIELD_TEXT.baseUrl;
  }
  if (f.clearKey) body.clearKey = true;
  else if (f.apiKey.trim()) {
    body.apiKey = f.apiKey.trim();
    if (!/^[\x21-\x7e]+$/.test(f.apiKey.trim())) errors.apiKey = FIELD_TEXT.apiKey;
  }
  for (const k of INT_KEYS) {
    const raw = f.ints[k].trim();
    if (raw === String(s[k])) continue;
    const v = Number(raw);
    body[k] = v;
    if (!/^\d+$/.test(raw) || v < LIMITS[k][0] || v > LIMITS[k][1]) errors[k] = FIELD_TEXT[k];
  }
  const names = f.headers.map((h) => h.name.trim());
  const changed =
    names.length !== s.headerNames.length || names.some((n, i) => n !== s.headerNames[i]) || f.headers.some((h) => h.value.trim() !== '' || h.orig === null);
  if (changed) {
    body.headers = f.headers.map((h) => ({ name: h.name.trim(), value: h.value.trim() || null }));
    const lower = names.map((n) => n.toLowerCase());
    const bad = f.headers.some(
      (h, i) =>
        !/^[A-Za-z0-9-]{1,64}$/.test(names[i]) ||
        lower.indexOf(lower[i]) !== i ||
        /^(content-type|content-length|host|anthropic-version|anthropic-beta)$/i.test(names[i]) ||
        (!h.value.trim() && !kept(h)) ||
        (h.value.trim() !== '' && !/^[\x20-\x7e]+$/.test(h.value.trim())),
    );
    if (bad) errors.headers = FIELD_TEXT.headers;
  }
  return { body, errors };
}

function status(s: AiSettings): { tone: Tone; badge: string; title: string; text: string } {
  if (s.problem === 'bad_json')
    return { tone: 'bad', badge: 'ไฟล์เสีย', title: 'อ่านไฟล์ตั้งค่า AI ไม่ได้', text: 'ไฟล์ var/secrets/ai.json บนเซิร์ฟเวอร์ไม่ใช่ JSON ที่ถูกต้อง บันทึกจากหน้านี้เพื่อเขียนไฟล์ใหม่' };
  if (!s.apiKeySet) return { tone: 'neutral', badge: 'ยังไม่ตั้งค่า', title: 'ยังไม่ได้ต่อ AI', text: 'ใส่ที่อยู่ gateway คีย์ และชื่อโมเดล แล้วกดบันทึก ปุ่มถาม AI และ AI ออกข้อสอบจะเปิดให้ทุกคนทันที' };
  if (!s.enabled) return { tone: 'gold', badge: 'ปิดอยู่', title: 'ปิด AI ไว้ชั่วคราว', text: 'คีย์ยังเก็บไว้ ผู้ใช้จะไม่เห็นปุ่มถาม AI และ AI ออกข้อสอบจนกว่าจะเปิดอีกครั้ง' };
  if (s.live) return { tone: 'good', badge: 'ใช้งานอยู่', title: 'AI พร้อมใช้งาน', text: `ใช้โมเดล ${s.model} ผ่าน ${s.baseUrl ?? 'Anthropic API โดยตรง'}` };
  return { tone: 'bad', badge: 'ใช้ไม่ได้', title: 'ตั้งค่าไม่ครบ', text: 'ตรวจที่อยู่ คีย์ และชื่อโมเดล แล้วลองกดทดสอบ' };
}

export function AiTab() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<Overview['usage'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [test, setTest] = useState<AiTestResult | null>(null);

  // Only the newest load fills the form, and never after the tab is gone: an older answer that comes back
  // late would otherwise put the saved values back over what the admin is typing (a key typed and lost).
  const latest = useRef(0);
  const load = () => {
    const n = ++latest.current;
    setLoadError(null);
    getAi().then(
      (r) => {
        if (n !== latest.current) return;
        setSettings(r.settings);
        setForm(formOf(r.settings));
      },
      (e) => n === latest.current && setLoadError(apiMessage(e)),
    );
    getOverview().then(
      (o) => n === latest.current && setUsage(o.usage),
      () => n === latest.current && setUsage(null),
    );
  };
  useEffect(() => {
    load();
    return () => {
      latest.current++;
    };
    // load once when the tab opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) {
    return (
      <div className="exam-card p-6">
        <Say tone="bad">{loadError}</Say>
        <button type="button" className="exam-btn mt-4" onClick={load}>
          ลองใหม่
        </button>
      </div>
    );
  }
  if (!settings || !form) {
    return (
      <p className="exam-card flex items-center gap-3 p-6 text-ex-muted">
        กำลังโหลดการตั้งค่า AI <WaitingDots />
      </p>
    );
  }

  const { body, errors: localErrors } = diff(settings, form);
  const dirty = Object.keys(body).length > 0;
  const shown = { ...localErrors, ...errors };
  const set = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setMessage(null);
  };
  const setInt = (k: IntKey, v: string) => set({ ints: { ...form.ints, [k]: v } });
  const setHeader = (key: number, patch: Partial<Header>) => set({ headers: form.headers.map((h) => (h.key === key ? { ...h, ...patch } : h)) });
  const st = status(settings);

  const save = async () => {
    if (Object.keys(localErrors).length) {
      setMessage({ tone: 'bad', text: 'ยังมีช่องที่ไม่ถูกต้อง แก้ช่องที่ขึ้นสีแดงก่อน' });
      return;
    }
    setBusy('save');
    setErrors({});
    setMessage(null);
    setTest(null);
    try {
      const r = await saveAi(body);
      setSettings(r.settings);
      setForm(formOf(r.settings));
      setMessage({ tone: 'good', text: 'บันทึกแล้ว มีผลทันทีโดยไม่ต้องรีสตาร์ต' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bad_field' && typeof e.data.field === 'string') {
        setErrors({ [e.data.field]: FIELD_TEXT[e.data.field] ?? apiMessage(e) });
      }
      setMessage({ tone: 'bad', text: apiMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    setMessage(null);
    try {
      setTest((await testAi()).result);
    } catch (e) {
      setMessage({ tone: 'bad', text: apiMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 pb-24">
      {/* where things stand */}
      <section className="exam-card p-5 sm:p-6" data-testid="ai-status" data-state={st.badge}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-72">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold">{st.title}</h2>
              <Badge tone={st.tone}>{st.badge}</Badge>
            </div>
            <p className="mt-1.5 leading-relaxed wrap-anywhere text-ex-muted">{st.text}</p>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              className="exam-btn"
              disabled={busy !== null || dirty || !settings.apiKeySet}
              onClick={() => void runTest()}
              data-testid="ai-test"
              title={dirty ? 'บันทึกก่อนแล้วค่อยทดสอบ' : undefined}
            >
              {busy === 'test' ? (
                <>
                  กำลังทดสอบ <WaitingDots />
                </>
              ) : (
                'ทดสอบการเชื่อมต่อ'
              )}
            </button>
            {dirty && settings.apiKeySet && <span className="text-xs text-ex-soft">บันทึกก่อนแล้วค่อยทดสอบ</span>}
          </div>
        </div>
        {test && (
          <div className="mt-4" data-testid="ai-test-result" data-ok={test.ok}>
            {test.ok ? (
              <Say tone="good">
                เชื่อมต่อได้ · ตอบใน {num(test.ms)} ms · โมเดล {test.model} · ตอบว่า “{test.reply}”
              </Say>
            ) : (
              <Say tone="bad">
                เชื่อมต่อไม่ได้{test.status ? ` (HTTP ${test.status})` : ''} · {test.message}
              </Say>
            )}
          </div>
        )}
        <div className="mt-3 border-t border-ex-line pt-1">
          <Switch
            checked={form.enabled}
            onChange={(on) => set({ enabled: on })}
            title="เปิดใช้ AI"
            text="ปิดไว้ชั่วคราวได้โดยไม่ต้องลบคีย์ เช่น เมื่อโควตาของ gateway ใกล้หมด"
            testid="ai-enabled"
          />
        </div>
      </section>

      {/* connection */}
      <section className="exam-card grid gap-4 p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">การเชื่อมต่อ</h2>
          <p className="mt-1 text-sm leading-relaxed text-ex-soft">
            คีย์และค่าใน header เก็บไว้บนเซิร์ฟเวอร์เท่านั้น (var/secrets/ai.json) หน้านี้ไม่ส่งค่าเดิมกลับมาให้เบราว์เซอร์ แสดงแค่ว่าตั้งไว้แล้วหรือยัง
          </p>
        </div>
        <Field label="ที่อยู่ gateway (Base URL)" error={shown.baseUrl} hint="เว้นว่างเพื่อต่อ Anthropic API โดยตรง">
          {(id) => (
            <input
              id={id}
              type="url"
              inputMode="url"
              value={form.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              className={`${inputClass} font-mono text-sm`}
              placeholder="https://gateway.example.com"
              autoComplete="off"
              spellCheck={false}
              data-testid="ai-baseurl"
            />
          )}
        </Field>
        <Field
          label="API key"
          error={shown.apiKey}
          hint={
            form.clearKey
              ? 'คีย์จะถูกลบเมื่อกดบันทึก และ AI จะหยุดทำงาน'
              : settings.apiKeySet
                ? 'มีคีย์อยู่แล้ว ใส่คีย์ใหม่เฉพาะเมื่อต้องการเปลี่ยน'
                : 'จำเป็น: ใช้เรียก gateway'
          }
        >
          {(id) => (
            <div className="flex flex-wrap gap-2">
              <input
                id={id}
                type="password"
                value={form.apiKey}
                onChange={(e) => set({ apiKey: e.target.value, clearKey: false })}
                className={`${inputClass} min-w-0 flex-1 basis-60 font-mono text-sm`}
                placeholder={settings.apiKeySet ? '•••••••• ตั้งไว้แล้ว — เว้นว่างเพื่อใช้คีย์เดิม' : 'วางคีย์ที่นี่'}
                autoComplete="new-password"
                spellCheck={false}
                disabled={form.clearKey}
                data-testid="ai-key"
              />
              {settings.apiKeySet && (
                <button type="button" className="exam-btn text-sm" onClick={() => set({ clearKey: !form.clearKey, apiKey: '' })} data-testid="ai-clear-key">
                  {form.clearKey ? 'ไม่ลบแล้ว' : 'ลบคีย์'}
                </button>
              )}
            </div>
          )}
        </Field>
        <Field label="โมเดล" error={shown.model} hint="ชื่อโมเดลตามที่ gateway รู้จัก">
          {(id) => (
            <input
              id={id}
              value={form.model}
              onChange={(e) => set({ model: e.target.value })}
              className={`${inputClass} font-mono text-sm`}
              autoComplete="off"
              spellCheck={false}
              data-testid="ai-model"
            />
          )}
        </Field>

        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold text-ex-muted">Header เพิ่มเติม</legend>
          <p className="mt-1 text-sm leading-relaxed text-ex-soft">สำหรับ gateway ที่ต้องการ header ของตัวเอง เช่น รหัสโปรเจกต์ ค่าเดิมจะไม่แสดง เว้นช่องค่าว่างไว้เพื่อใช้ค่าเดิม</p>
          <div className="mt-3 grid gap-2" data-testid="ai-headers">
            {form.headers.map((h) => (
              <div key={h.key} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="ชื่อ header"
                  value={h.name}
                  onChange={(e) => setHeader(h.key, { name: e.target.value })}
                  className={`${inputClass} min-w-0 flex-1 basis-40 font-mono text-sm`}
                  placeholder="X-Header-Name"
                  spellCheck={false}
                  data-testid="ai-header-name"
                />
                <input
                  aria-label={`ค่าของ ${h.name || 'header'}`}
                  type="password"
                  value={h.value}
                  onChange={(e) => setHeader(h.key, { value: e.target.value })}
                  className={`${inputClass} min-w-0 flex-[2] basis-48 font-mono text-sm`}
                  placeholder={kept(h) ? '•••••••• ตั้งไว้แล้ว' : 'ค่า'}
                  autoComplete="new-password"
                  spellCheck={false}
                  data-testid="ai-header-value"
                />
                <button
                  type="button"
                  className="exam-btn exam-btn-quiet min-h-10 px-2.5"
                  aria-label={`ลบ header ${h.name}`}
                  onClick={() => set({ headers: form.headers.filter((x) => x.key !== h.key) })}
                >
                  <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {shown.headers && <p className="mt-2 text-sm text-ex-bad">{shown.headers}</p>}
          {form.headers.length < MAX_HEADERS && (
            <button
              type="button"
              className="exam-btn exam-btn-quiet mt-2 text-sm"
              onClick={() => set({ headers: [...form.headers, { key: ++headerKey, name: '', value: '', orig: null }] })}
              data-testid="ai-add-header"
            >
              + เพิ่ม header
            </button>
          )}
        </fieldset>
      </section>

      {/* how it answers */}
      <section className="exam-card grid gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">การทำงาน</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ความละเอียดในการคิด · ถาม AI" hint="สูงขึ้น = คำตอบรอบคอบขึ้น แต่ช้าและใช้ token มากขึ้น">
            {(id) => (
              <select id={id} value={form.effort} onChange={(e) => set({ effort: e.target.value as Effort })} className={inputClass} data-testid="ai-effort">
                {(Object.keys(EFFORT_LABEL) as Effort[]).map((e) => (
                  <option key={e} value={e}>
                    {EFFORT_LABEL[e]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="ความละเอียดในการคิด · AI ออกข้อสอบ" hint="ข้อสอบที่ดีต้องคิดเยอะ แนะนำ “กลาง” ขึ้นไป">
            {(id) => (
              <select id={id} value={form.quizEffort} onChange={(e) => set({ quizEffort: e.target.value as Effort })} className={inputClass} data-testid="ai-quiz-effort">
                {(Object.keys(EFFORT_LABEL) as Effort[]).map((e) => (
                  <option key={e} value={e}>
                    {EFFORT_LABEL[e]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="ความยาวคำตอบสูงสุด (token)" error={shown.maxTokens} hint={`${LIMITS.maxTokens[0]}–${num(LIMITS.maxTokens[1])} ต่อครั้ง`}>
            {(id) => (
              <input id={id} inputMode="numeric" value={form.ints.maxTokens} onChange={(e) => setInt('maxTokens', e.target.value)} className={inputClass} data-testid="ai-max-tokens" />
            )}
          </Field>
        </div>
        <div className="divide-y divide-ex-line border-t border-ex-line">
          <Switch
            checked={form.fallbacks}
            onChange={(on) => set({ fallbacks: on })}
            title="ลองโมเดลสำรองเมื่อโมเดลหลักไม่ว่าง"
            text="ให้ gateway สลับไปโมเดลรุ่นใกล้เคียงเองเมื่อโมเดลหลักตอบไม่ได้ชั่วคราว"
            testid="ai-fallbacks"
          />
          <Switch
            checked={form.structuredOutput}
            onChange={(on) => set({ structuredOutput: on })}
            title="ขอผลลัพธ์แบบมีโครงสร้าง (AI ออกข้อสอบ)"
            text="ปิดเฉพาะเมื่อ gateway ไม่รองรับ ระบบจะตรวจรูปแบบข้อสอบเองแทน"
            testid="ai-structured"
          />
        </div>
      </section>

      {/* limits */}
      <section className="exam-card grid gap-4 p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">โควตาและผู้ใช้</h2>
          <p className="mt-1 text-sm leading-relaxed text-ex-soft">นับรอบวันตามเวลาประเทศไทย เมื่อครบโควตา ผู้ใช้จะเห็นข้อความให้ลองใหม่พรุ่งนี้</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="ถาม AI ต่อคนต่อวัน" error={shown.perPersonPerDay}>
            {(id) => (
              <input id={id} inputMode="numeric" value={form.ints.perPersonPerDay} onChange={(e) => setInt('perPersonPerDay', e.target.value)} className={inputClass} data-testid="ai-per-person" />
            )}
          </Field>
          <Field label="ถาม AI รวมทั้งระบบต่อวัน" error={shown.perDay}>
            {(id) => <input id={id} inputMode="numeric" value={form.ints.perDay} onChange={(e) => setInt('perDay', e.target.value)} className={inputClass} data-testid="ai-per-day" />}
          </Field>
          <Field label="AI ออกข้อสอบต่อคนต่อวัน" error={shown.quizPerPersonPerDay}>
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                value={form.ints.quizPerPersonPerDay}
                onChange={(e) => setInt('quizPerPersonPerDay', e.target.value)}
                className={inputClass}
                data-testid="ai-quiz-per-person"
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ex-muted">ใครใช้ปุ่มถาม AI ได้</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['signed-in', 'เฉพาะคนที่เข้าสู่ระบบ', 'แนะนำ: รู้ว่าใครใช้ และคุมโควตารายคนได้แม่นยำ'],
                ['anyone', 'ทุกคนที่เปิดเว็บ', 'รวมผู้เล่นที่ไม่ได้เข้าสู่ระบบ นับโควตาตามเครื่อง'],
              ] as const
            ).map(([v, t, d]) => (
              <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${form.who === v ? 'border-ex-accent bg-ex-accent/10' : 'border-ex-line hover:border-ex-line-strong'}`}>
                <input type="radio" name="ai-who" checked={form.who === v} onChange={() => set({ who: v })} className="mt-1 accent-[#93a3ff]" data-testid={`ai-who-${v}`} />
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-ex-soft">{d}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-ex-soft">AI ออกข้อสอบใช้ได้เฉพาะคนที่เข้าสู่ระบบและได้รับสิทธิ์เสมอ</p>
        </fieldset>
      </section>

      <Usage usage={usage} />

      {/* the save bar: only while there is something to save */}
      {(dirty || message) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ex-line-strong bg-night/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur" data-testid="ai-save-bar">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 basis-60 text-sm" role={message?.tone === 'bad' ? 'alert' : 'status'}>
              {message ? <span className={message.tone === 'good' ? 'text-ex-good' : 'text-ex-bad'}>{message.text}</span> : <span className="text-ex-muted">มีการแก้ไขที่ยังไม่ได้บันทึก</span>}
            </p>
            {dirty ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="exam-btn"
                  disabled={busy !== null}
                  onClick={() => {
                    setForm(formOf(settings));
                    setErrors({});
                    setMessage(null);
                  }}
                >
                  ยกเลิก
                </button>
                <button type="button" className="exam-btn exam-btn-primary" disabled={busy !== null} onClick={() => void save()} data-testid="ai-save">
                  {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            ) : (
              <button type="button" className="exam-btn exam-btn-quiet" onClick={() => setMessage(null)}>
                ปิด
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const dayLabel = (day: string) => new Date(`${day}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });

function Usage({ usage }: { usage: Overview['usage'] | null }) {
  if (!usage) return null;
  const max = Math.max(1, ...usage.days.map((d) => d.asks + d.quiz));
  const total = usage.days.reduce((a, d) => ({ asks: a.asks + d.asks, quiz: a.quiz + d.quiz, tokens: a.tokens + d.tokensIn + d.tokensOut }), { asks: 0, quiz: 0, tokens: 0 });
  return (
    <section className="exam-card grid gap-5 p-5 sm:p-6" data-testid="ai-usage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">การใช้งาน 7 วันล่าสุด</h2>
        <p className="text-sm text-ex-soft">
          ถาม {num(total.asks)} ครั้ง · ออกข้อสอบ {num(total.quiz)} ครั้ง · {num(total.tokens)} token
        </p>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-ex-soft" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-2" /> ถาม AI
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-gold" /> AI ออกข้อสอบ
        </span>
      </div>
      <ol className="grid gap-2.5">
        {usage.days.map((d) => (
          <li key={d.day} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[7rem_1fr_auto]">
            <span className="truncate text-ex-muted">{dayLabel(d.day)}</span>
            <span className="flex h-3 overflow-hidden rounded-full bg-white/[0.05]" role="img" aria-label={`ถาม ${d.asks} ครั้ง ออกข้อสอบ ${d.quiz} ครั้ง`}>
              <span className="h-full bg-brand-2" style={{ width: `${(d.asks / max) * 100}%` }} />
              <span className="h-full bg-gold" style={{ width: `${(d.quiz / max) * 100}%` }} />
            </span>
            <span className="w-12 text-right font-semibold tabular-nums">{num(d.asks + d.quiz)}</span>
          </li>
        ))}
      </ol>
      {usage.top.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ex-muted">ใช้มากที่สุด</h3>
          <ul className="divide-y divide-ex-line rounded-xl border border-ex-line">
            {usage.top.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className={`min-w-0 truncate ${t.name ? 'font-semibold' : 'text-ex-soft'}`}>{t.name ?? 'ผู้เล่นที่ไม่ได้เข้าสู่ระบบ'}</span>
                <span className="shrink-0 text-ex-soft tabular-nums">
                  ถาม {num(t.asks)} · ข้อสอบ {num(t.quiz)} · {num(t.tokens)} token
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
