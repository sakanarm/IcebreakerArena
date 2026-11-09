/**
 * Talking to Pika, the company's knowledge base.
 *
 * Two kinds of key, and the difference is the whole design:
 *  - the **org key** (var/secrets/pika-org-key) can make projects. It is read here and never
 *    leaves this file.
 *  - a **project key**, which the org key issues once per person, can only read that person's own
 *    project. Everything the app does afterwards uses that key, so a mistake here cannot reach
 *    anybody else's pages.
 *
 * A person's project is `icebreaking_<the part of their email before the @>`, with the full email
 * as its owner, so the person can open it in Pika themselves and see exactly what we see.
 *
 * Keys are kept as files under var/secrets (mode 600), the way every other secret in this app is,
 * and never in the database: a database backup or a dump handed to another team then has no key in
 * it. A lost file is not a disaster — the org key can always issue another.
 *
 * Nothing from Pika is trusted: a game built from it is marked `tainted`, so it can never be shared
 * into the public catalog. And every error is passed through `redact`, because a key that reaches a
 * log is a key that has to be revoked.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir, readSecret } from './config';
import { HttpError } from './http';

/** Anything that looks like a key, in any string on its way to a log or a browser. */
export const redact = (s: string) => s.replace(/pika_(?:live|org|test)_[A-Za-z0-9_-]+/g, '<คีย์ถูกซ่อนไว้>');

/** The Pika REST root. Set PIKA_BASE_URL to point a test at a fake one. */
export const pikaBase = () => (process.env.PIKA_BASE_URL?.trim() || 'https://dmhub.mfec.dev/Pika/api/v1').replace(/\/+$/, '');

const orgKey = () => readSecret('pika-org-key');

/** Whether this machine can make projects at all. Without the org key the button stays off. */
export const pikaConfigured = () => orgKey() !== null;

/** One request takes this long at most: a slow knowledge base must not hold a page open. */
const TIMEOUT_MS = 20_000;

export interface PikaProject {
  /** `icebreaking_<local part>` */
  projectId: string;
  /** the key's own id, for revoking it later */
  clientId: string | null;
  /** `pika_live_…` — never logged, never sent to the browser */
  key: string;
  createdAt: number;
}

export interface PikaDocument {
  documentId: string;
  title: string;
  sourceRef: string | null;
  /** the date the document itself carries, not the day it was ingested */
  docDate: string | null;
  ingestedDate: string | null;
  bytes: number | null;
  /** the wiki pages this document was turned into */
  pages: string[];
}

export interface PikaHit {
  path: string;
  title: string;
  snippet: string;
  score: number | null;
}

export interface PikaPage {
  path: string;
  title: string;
  /** the page's markdown, as Pika wrote it */
  content: string;
}

// ---------- the project a person reads through ----------

/**
 * A person's project id: lowercase, the part of the email before the @, and nothing that could
 * change the shape of a url. Two people whose emails differ only in punctuation would collide, so
 * the characters that are left out are replaced rather than dropped.
 */
export function projectIdFor(email: string): string {
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  const slug = local.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) throw new HttpError(400, 'bad_email');
  return `icebreaking_${slug}`;
}

const projectFile = (projectId: string) => path.join(dataDir(), 'secrets', 'pika-projects', `${projectId}.json`);

/**
 * The stored record for a project, or null. Written by this file and by hand during setup, so the
 * field names are read loosely: a file that works must keep working after an upgrade.
 */
export function readProject(projectId: string): PikaProject | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(projectFile(projectId), 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (...names: string[]) => {
    for (const n of names) if (typeof r[n] === 'string' && (r[n] as string).trim()) return (r[n] as string).trim();
    return null;
  };
  const key = str('key', 'api_key', 'apiKey', 'client_secret', 'secret');
  if (!key) return null;
  return {
    projectId: str('project_id', 'projectId', 'id') ?? projectId,
    clientId: str('client_id', 'clientId'),
    key,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : typeof r.created_at === 'number' ? r.created_at : 0,
  };
}

/** Writes the record so that a reader never sees half a file, and nobody else can read it at all. */
export function writeProject(p: PikaProject): void {
  const file = projectFile(p.projectId);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  const body = JSON.stringify({ project_id: p.projectId, client_id: p.clientId, key: p.key, createdAt: p.createdAt }, null, 2);
  writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
}

// ---------- the requests themselves ----------

type Query = Record<string, string | number | undefined>;

async function call(key: string, method: 'GET' | 'POST' | 'DELETE', route: string, { query, body }: { query?: Query; body?: unknown } = {}): Promise<unknown> {
  const url = new URL(`${pikaBase()}${route}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (e) {
    // a timeout, dns, tls or a proxy in between: the knowledge base is not answering
    console.error('[pika]', redact(e instanceof Error ? e.message : String(e)));
    throw new HttpError(502, 'pika_unreachable');
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error(`[pika] ${method} ${route} → ${res.status} ${redact(text).slice(0, 400)}`);
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'pika_denied');
    if (res.status === 404) throw new HttpError(404, 'pika_not_found');
    if (res.status === 429) throw new HttpError(429, 'pika_busy');
    throw new HttpError(502, 'pika_failed');
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.error(`[pika] ${method} ${route} → answer was not json`);
    throw new HttpError(502, 'pika_failed');
  }
}

// ---------- reading the answers loosely ----------

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The list inside an answer, whatever the envelope is called. */
function listOf(v: unknown, ...names: string[]): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.map(obj);
  const o = obj(v);
  for (const n of [...names, 'items', 'results', 'data']) if (Array.isArray(o[n])) return (o[n] as unknown[]).map(obj);
  return [];
}

const pick = (o: Record<string, unknown>, ...names: string[]): string => {
  for (const n of names) {
    const v = o[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
};

const num = (o: Record<string, unknown>, ...names: string[]): number | null => {
  for (const n of names) if (typeof o[n] === 'number' && Number.isFinite(o[n])) return o[n] as number;
  return null;
};

/** The key a create answer carries, under whichever name this version of Pika uses. */
const keyIn = (o: Record<string, unknown>): string => {
  const direct = pick(o, 'api_key', 'apiKey', 'key', 'client_secret', 'secret', 'token');
  if (direct) return direct;
  for (const nested of ['api_key', 'key', 'project_key', 'credentials', 'project']) {
    const inner = obj(o[nested]);
    const found = pick(inner, 'api_key', 'apiKey', 'key', 'client_secret', 'secret', 'token');
    if (found) return found;
  }
  return '';
};

// ---------- what the app actually does ----------

/**
 * The person's project, making it the first time they ask for one. Pika's create is idempotent on
 * the project id, but only the first call hands back a key — so a project that exists without a key
 * on our side gets a new key issued for it rather than a second project.
 */
export async function ensureProject(email: string, displayName?: string): Promise<PikaProject> {
  const projectId = projectIdFor(email);
  const stored = readProject(projectId);
  if (stored) return stored;

  const key = orgKey();
  if (!key) throw new HttpError(503, 'pika_off');

  const name = `IceBreaking ${displayName?.trim() || email.split('@')[0]}`;
  const created = obj(
    await call(key, 'POST', '/projects', {
      body: { name, id: projectId, owner_username: email.trim(), description: 'คลังความรู้ส่วนตัวสำหรับสร้างเกมใน Pika Arena' },
    }),
  );

  let projectKey = keyIn(created);
  let clientId = pick(created, 'client_id', 'clientId') || null;
  if (!projectKey) {
    // the project was already there: ask for a key of its own
    const issued = obj(await call(key, 'POST', `/projects/${encodeURIComponent(projectId)}/api-keys`, { body: { name: 'Pika Arena' } }));
    projectKey = keyIn(issued);
    clientId = pick(issued, 'client_id', 'clientId') || clientId;
  }
  if (!projectKey) {
    console.error('[pika] create answered without a project key');
    throw new HttpError(502, 'pika_failed');
  }

  const project: PikaProject = { projectId, clientId, key: projectKey, createdAt: Date.now() };
  writeProject(project);
  return project;
}

/** The project a person already has, or null — asked before anything is created, so a page can offer. */
export const existingProject = (email: string): PikaProject | null => readProject(projectIdFor(email));

/** What is in the project: the documents someone has put there, newest page list first. */
export async function listDocuments(p: PikaProject, { limit = 50, offset = 0 } = {}): Promise<{ documents: PikaDocument[]; total: number }> {
  const answer = await call(p.key, 'GET', `/projects/${encodeURIComponent(p.projectId)}/documents`, { query: { limit, offset } });
  const rows = listOf(answer, 'documents');
  const documents = rows.map((r) => ({
    documentId: pick(r, 'document_id', 'documentId', 'id'),
    title: pick(r, 'title', 'name') || pick(r, 'source_ref') || 'ไม่มีชื่อเรื่อง',
    sourceRef: pick(r, 'source_ref', 'sourceRef') || null,
    docDate: pick(r, 'doc_date', 'docDate') || null,
    ingestedDate: pick(r, 'ingested_date', 'ingestedDate', 'created_at') || null,
    bytes: num(r, 'bytes', 'size'),
    pages: (Array.isArray(r.pages) ? r.pages : []).map((x) => (typeof x === 'string' ? x : pick(obj(x), 'file_path', 'path', 'title'))).filter(Boolean),
  }));
  const total = num(obj(answer), 'total', 'count') ?? documents.length + offset;
  return { documents, total };
}

/** Pages that answer a question, so someone can find what to build a quiz from without browsing. */
export async function searchPages(p: PikaProject, query: string, topK = 10): Promise<PikaHit[]> {
  const answer = await call(p.key, 'POST', `/projects/${encodeURIComponent(p.projectId)}/search`, { body: { query, top_k: topK } });
  const seen = new Set<string>();
  const hits: PikaHit[] = [];
  for (const r of listOf(answer, 'hits', 'matches')) {
    const file = pick(r, 'file_path', 'filePath', 'path');
    if (!file || seen.has(file)) continue;
    seen.add(file);
    hits.push({ path: file, title: pick(r, 'title') || file, snippet: pick(r, 'snippet', 'text', 'content').slice(0, 400), score: num(r, 'score') });
  }
  return hits;
}

/** One page, as markdown. Null when the path is not a page in this project. */
export async function readPage(p: PikaProject, pagePath: string): Promise<PikaPage | null> {
  const answer = obj(await call(p.key, 'GET', `/projects/${encodeURIComponent(p.projectId)}/pages`, { query: { path: pagePath } }));
  const content = pick(answer, 'content', 'markdown', 'text');
  if (!content) return null;
  return { path: pick(answer, 'file_path', 'filePath', 'path') || pagePath, title: pick(answer, 'title') || pagePath, content };
}
