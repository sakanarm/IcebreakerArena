import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { AI_DEFAULTS, aiConfig, claudeClient, hideKey, type AiConfig } from './ai';
import { dataDir, readSecret } from './config';
import type { Sql } from './db';
import { HttpError } from './http';

/**
 * The AI (LLM) tab of the admin page: var/secrets/ai.json, read and written here. ai.ts reads the file
 * on every request, so a save takes effect at once, no restart.
 *
 * Secrets never leave the server: the key and every header value are written, never read back to a
 * browser. The page is told only that a key is set and which header names there are; saving with the
 * key left blank keeps the one in the file, and a header sent with no value keeps its value. Fields
 * this page does not know about are kept as they are in the file.
 */

const FILE = 'ai.json';
const EFFORTS = ['low', 'medium', 'high'] as const;
type Effort = (typeof EFFORTS)[number];

/** what the page may know: everything but the secrets */
export interface AiSettingsView {
  /** the file exists and holds a JSON object */
  configured: boolean;
  /** the file is there but can't be used as it is (not JSON, not an object) */
  problem: 'bad_json' | null;
  /** on unless turned off here; AI answers only when this is on and a key is set */
  enabled: boolean;
  apiKeySet: boolean;
  baseUrl: string | null;
  headerNames: string[];
  model: string;
  effort: Effort;
  maxTokens: number;
  fallbacks: boolean;
  perPersonPerDay: number;
  perDay: number;
  who: 'anyone' | 'signed-in';
  quizPerPersonPerDay: number;
  quizEffort: Effort;
  structuredOutput: boolean;
  /** whether exam mode and the create page are offering AI right now */
  live: boolean;
}

export const AI_LIMITS_ADMIN = {
  maxTokens: [256, 16000],
  perPersonPerDay: [1, 10000],
  perDay: [1, 1000000],
  quizPerPersonPerDay: [1, 1000],
  headers: 10,
} as const;

type Raw = Record<string, unknown>;

function readRaw(): { raw: Raw; configured: boolean; problem: AiSettingsView['problem'] } {
  const text = readSecret(FILE);
  if (!text) return { raw: {}, configured: false, problem: null };
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return { raw: v as Raw, configured: true, problem: null };
  } catch {
    // shown as a problem; a save writes a good file over it
  }
  return { raw: {}, configured: true, problem: 'bad_json' };
}

const headersOf = (raw: Raw): Record<string, string> => {
  const h = raw.headers;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
  return Object.fromEntries(Object.entries(h).filter(([k, v]) => typeof v === 'string' && /^[a-z0-9-]+$/i.test(k))) as Record<string, string>;
};

// as ai.ts reads it: a positive whole number, capped
const intIn = (v: unknown, [, hi]: readonly [number, number], fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, hi) : fallback;

export function aiSettingsView(): AiSettingsView {
  const { raw, configured, problem } = readRaw();
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');
  return {
    configured,
    problem,
    enabled: raw.enabled !== false,
    apiKeySet: str('apiKey') !== '',
    baseUrl: /^https?:\/\//i.test(str('baseUrl')) ? str('baseUrl') : null,
    headerNames: Object.keys(headersOf(raw)),
    model: str('model') || AI_DEFAULTS.model,
    effort: EFFORTS.includes(raw.effort as Effort) ? (raw.effort as Effort) : AI_DEFAULTS.effort,
    maxTokens: intIn(raw.maxTokens, [1, 16000], AI_DEFAULTS.maxTokens),
    fallbacks: raw.fallbacks !== false,
    perPersonPerDay: intIn(raw.perPersonPerDay, [1, 10000], AI_DEFAULTS.perPersonPerDay),
    perDay: intIn(raw.perDay, [1, 1000000], AI_DEFAULTS.perDay),
    who: raw.who === 'signed-in' ? 'signed-in' : 'anyone',
    quizPerPersonPerDay: intIn(raw.quizPerPersonPerDay, [1, 1000], AI_DEFAULTS.quizPerPersonPerDay),
    quizEffort: EFFORTS.includes(raw.quizEffort as Effort) ? (raw.quizEffort as Effort) : AI_DEFAULTS.quizEffort,
    structuredOutput: raw.structuredOutput !== false,
    live: aiConfig() !== null,
  };
}

const bad = (field: string) => new HttpError(400, 'bad_field', { field });

// a key or header value: printable, no spaces or line breaks (they would split the HTTP header)
const TOKEN = /^[\x21-\x7e]+$/;

/** The page's form, checked field by field, merged onto the file. Returns what to write. */
export function mergeAiSettings(raw: Raw, body: Record<string, unknown>): Raw {
  const next: Raw = { ...raw };
  const bool = (k: string) => {
    if (!(k in body)) return;
    if (typeof body[k] !== 'boolean') throw bad(k);
    next[k] = body[k];
  };
  const int = (k: keyof typeof AI_LIMITS_ADMIN & string) => {
    if (!(k in body)) return;
    const [lo, hi] = AI_LIMITS_ADMIN[k] as readonly [number, number];
    const v = body[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw bad(k);
    next[k] = v;
  };
  const effort = (k: string) => {
    if (!(k in body)) return;
    if (!EFFORTS.includes(body[k] as Effort)) throw bad(k);
    next[k] = body[k];
  };

  bool('enabled');
  bool('fallbacks');
  bool('structuredOutput');
  int('maxTokens');
  int('perPersonPerDay');
  int('perDay');
  int('quizPerPersonPerDay');
  effort('effort');
  effort('quizEffort');

  if ('who' in body) {
    if (body.who !== 'anyone' && body.who !== 'signed-in') throw bad('who');
    next.who = body.who;
  }
  if ('model' in body) {
    const m = typeof body.model === 'string' ? body.model.trim() : null;
    if (m === null || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/.test(m)) throw bad('model');
    next.model = m;
  }
  if ('baseUrl' in body) {
    const v = body.baseUrl;
    if (v === null || v === '') delete next.baseUrl;
    else {
      if (typeof v !== 'string' || v.length > 500) throw bad('baseUrl');
      let url: URL;
      try {
        url = new URL(v.trim());
      } catch {
        throw bad('baseUrl');
      }
      // a password in the address would be shown back on this page; it goes in a header instead
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw bad('baseUrl');
      next.baseUrl = url.href.replace(/\/+$/, '');
    }
  }
  // the key: a new one replaces it, blank keeps it, clearKey removes it
  if (body.clearKey === true) delete next.apiKey;
  else if ('apiKey' in body && body.apiKey !== '' && body.apiKey !== null) {
    const k = typeof body.apiKey === 'string' ? body.apiKey.trim() : null;
    if (!k || k.length > 1000 || !TOKEN.test(k)) throw bad('apiKey');
    next.apiKey = k;
  }
  // headers: the list is the whole set; a value of null keeps what the file has for that name
  if ('headers' in body) {
    const list = body.headers;
    if (!Array.isArray(list) || list.length > AI_LIMITS_ADMIN.headers) throw bad('headers');
    const old = headersOf(raw);
    const out: Record<string, string> = {};
    for (const h of list as unknown[]) {
      const e = h as { name?: unknown; value?: unknown } | null;
      const name = typeof e?.name === 'string' ? e.name.trim() : '';
      if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) throw bad('headers');
      const key = Object.keys(out).find((k) => k.toLowerCase() === name.toLowerCase());
      if (key) throw bad('headers');
      // the SDK sets these itself; a header of ours would fight with it
      if (/^(content-type|content-length|host|anthropic-version|anthropic-beta)$/i.test(name)) throw bad('headers');
      if (e?.value === null || e?.value === undefined || e.value === '') {
        const kept = Object.entries(old).find(([k]) => k.toLowerCase() === name.toLowerCase());
        if (!kept) throw bad('headers');
        out[name] = kept[1];
      } else {
        const v = typeof e.value === 'string' ? e.value.trim() : '';
        if (!v || v.length > 2000 || !/^[\x20-\x7e]+$/.test(v)) throw bad('headers');
        out[name] = v;
      }
    }
    if (Object.keys(out).length) next.headers = out;
    else delete next.headers;
  }
  return next;
}

let saving: Promise<unknown> = Promise.resolve();

/** Writes the file whole or not at all: a new file next to it (mode 600), then a rename over it. */
function writeSecretFile(name: string, text: string) {
  const dir = path.join(dataDir(), 'secrets');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, path.join(dir, name));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Saves the page's form. One save at a time, so two admins can't half-overwrite each other. */
export function saveAiSettings(body: Record<string, unknown>): Promise<{ view: AiSettingsView; changed: string[] }> {
  const run = saving.then(() => {
    const { raw, problem } = readRaw();
    const next = mergeAiSettings(problem ? {} : raw, body);
    const changed = [...new Set([...Object.keys(raw), ...Object.keys(next)])].filter((k) => JSON.stringify(raw[k]) !== JSON.stringify(next[k])).sort();
    writeSecretFile(FILE, `${JSON.stringify(next, null, 2)}\n`);
    return { view: aiSettingsView(), changed };
  });
  saving = run.catch(() => {});
  return run;
}

/** Everything a provider's error might echo back that must not reach a page: the key and the header values. */
function scrub(text: string, c: AiConfig): string {
  let out = hideKey(text, c.apiKey);
  for (const v of Object.values(c.headers)) if (v.length >= 4) out = out.split(v).join('<HIDDEN>');
  return out;
}

let testing = false;
let tests: number[] = [];

export type AiTestResult =
  | { ok: true; ms: number; model: string; reply: string }
  | { ok: false; ms: number; status: number | null; message: string };

/**
 * One tiny call with the saved settings, so the admin knows the address, key and model work before
 * anyone in an exam finds out. Uses the same request shape as a real question (with or without the
 * fallback beta). At most one at a time and 10 a minute.
 */
export async function testAi(now = Date.now()): Promise<AiTestResult> {
  const c = aiConfig({ evenIfOff: true });
  if (!c) throw new HttpError(409, 'ai_not_set');
  tests = tests.filter((t) => now - t < 60_000);
  if (testing || tests.length >= 10) throw new HttpError(429, 'rate_limited');
  testing = true;
  tests.push(now);
  const started = Date.now();
  try {
    const client = claudeClient(c, 30_000);
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Reply with exactly one word: OK' }];
    const res = c.fallbacks
      ? await client.beta.messages.create({
          model: c.model,
          max_tokens: 256,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          messages,
        })
      : await client.messages.create({ model: c.model, max_tokens: 256, output_config: { effort: 'low' }, messages });
    const reply = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
      .slice(0, 200);
    return { ok: true, ms: Date.now() - started, model: res.model, reply: scrub(reply, c) };
  } catch (e) {
    const status = e instanceof Anthropic.APIError && typeof e.status === 'number' ? e.status : null;
    const message = e instanceof Anthropic.APIConnectionTimeoutError ? 'timeout' : e instanceof Error ? e.message : String(e);
    return { ok: false, ms: Date.now() - started, status, message: scrub(message, c).slice(0, 400) };
  } finally {
    testing = false;
  }
}

/** For tests: forget the test calls. */
export const resetAiTests = () => {
  tests = [];
  testing = false;
};

const TODAY = "(now() AT TIME ZONE 'Asia/Bangkok')::date";

/** The last 7 Bangkok days of AI use, and who used most this week (accounts by name; people not logged in as one line). */
export async function aiUsage(sql: Sql) {
  const days = await sql.query<{ day: string; asks: number; quiz: number; tokens_in: string; tokens_out: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day,
            coalesce(sum(asks) FILTER (WHERE who NOT LIKE 'q:%'), 0)::int AS asks,
            coalesce(sum(asks) FILTER (WHERE who LIKE 'q:%'), 0)::int AS quiz,
            coalesce(sum(tokens_in), 0)::text AS tokens_in, coalesce(sum(tokens_out), 0)::text AS tokens_out
       FROM ib_ai_usage WHERE day > ${TODAY} - 7 GROUP BY day ORDER BY day DESC`,
  );
  const top = await sql.query<{ name: string | null; anonymous: boolean; asks: number; quiz: number; tokens: string }>(
    `SELECT u.display_name AS name, (x.uid IS NULL) AS anonymous,
            coalesce(sum(x.asks) FILTER (WHERE NOT x.quiz), 0)::int AS asks,
            coalesce(sum(x.asks) FILTER (WHERE x.quiz), 0)::int AS quiz,
            coalesce(sum(x.tokens), 0)::text AS tokens
       FROM (SELECT asks, tokens_in + tokens_out AS tokens, who LIKE 'q:%' AS quiz,
                    CASE WHEN who LIKE 'u:%' THEN substr(who, 3) WHEN who LIKE 'q:u:%' THEN substr(who, 5) END AS uid
               FROM ib_ai_usage WHERE day > ${TODAY} - 7) x
       LEFT JOIN ib_users u ON u.id = x.uid
      GROUP BY u.display_name, x.uid IS NULL, x.uid
      ORDER BY sum(x.asks) DESC LIMIT 11`,
  );
  return {
    days: days.map((d) => ({ day: d.day, asks: d.asks, quiz: d.quiz, tokensIn: Number(d.tokens_in), tokensOut: Number(d.tokens_out) })),
    top: top.map((t) => ({ name: t.anonymous ? null : (t.name ?? '—'), asks: t.asks, quiz: t.quiz, tokens: Number(t.tokens) })),
  };
}
