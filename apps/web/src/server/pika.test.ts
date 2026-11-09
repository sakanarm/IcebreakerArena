/**
 * The knowledge-base feature end to end: the key on disk, the requests, the review screen's facts,
 * and the game they become.
 *
 * Pika itself is a small http server started here, so every answer it could give — including the
 * ones nobody wants: a page that was deleted, a busy knowledge base, an answer that is not json —
 * is covered by a test rather than by hope. Two things are checked in every direction: a key never
 * reaches a browser or a log, and a game built from these pages can never be shared.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { MAX_PAGES, validateGame, type Game } from '@pika-arena/shared';
import { GET as documentsGET } from '@/app/api/pika/documents/route';
import { POST as draftPOST } from '@/app/api/pika/draft/route';
import { POST as factsPOST } from '@/app/api/pika/facts/route';
import { GET as projectGET, POST as projectPOST } from '@/app/api/pika/project/route';
import { POST as searchPOST } from '@/app/api/pika/search/route';
import { upsertUser } from './auth';
import { shareGame } from './catalog';
import { getDb, type Db } from './db';
import { listGames } from './games';
import { HttpError } from './http';
import {
  ensureProject,
  existingProject,
  listDocuments,
  pikaConfigured,
  projectIdFor,
  readPage,
  readProject,
  redact,
  searchPages,
  writeProject,
  type PikaProject,
} from './pika';
import { createSession, type SessionUser } from './session';

// ---------- a machine of our own: data folder, secrets, accounts on ----------

const DIR = mkdtempSync(path.join(tmpdir(), 'ib-pika-'));
process.env.IB_DATA_DIR = DIR;
process.env.AUTH_MODE = 'mock';
// not production, whatever the shell says: a laptop's PGlite, and the plain cookie name
(process.env as Record<string, string>).NODE_ENV = 'test';
// a developer's own database must never be touched by a test
delete process.env.DATABASE_URL;

const ORG_KEY = 'pika_org_TESTONLY_0000000000';
const PROJECT_KEY = 'pika_live_TESTONLY_1111111111';
const ISSUED_KEY = 'pika_live_TESTONLY_2222222222';
const orgKeyFile = path.join(DIR, 'secrets', 'pika-org-key');

const EMAIL = 'sakan_pu@mfec.co.th';
const PROJECT = 'icebreaking_sakan_pu';

// ---------- the pages the fake knowledge base holds ----------

const ARENA = [
  '# Pika Arena',
  '',
  '## Summary',
  'Pika Arena เป็นเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรมในองค์กร',
  '',
  '## Details',
  '- ห้องเล่นหนึ่งห้องรองรับผู้เล่นพร้อมกันได้ 1000 คน [[sources/arena-notes.md]]',
  '- ระบบเรียลไทม์ของเกมใช้ **Socket.IO** เป็นตัวส่งข้อมูลระหว่างเครื่องผู้เล่นกับเซิร์ฟเวอร์ [[sources/arena-notes.md]]',
  '- ฐานข้อมูลที่เกมนี้ใช้คือ PostgreSQL [[sources/stack.md]]',
  '- ติดต่อทีมงานได้ที่ support@example.com หากพบปัญหาระหว่างเล่น [[sources/arena-notes.md]]',
  '- สั้นไป',
  '',
  '## Related',
  '- [[systems/stack.md]]',
].join('\n');

const STACK = [
  '# ระบบและเครื่องมือ',
  '',
  '## Summary',
  'ภาพรวมของเครื่องมือที่ทีมใช้ทำเกมและดูแลเซิร์ฟเวอร์',
  '',
  '## Details',
  '- เซิร์ฟเวอร์เกมรันด้วย Node.js และดูแลโพรเซสด้วย pm2 ตลอดเวลา [[sources/stack.md]]',
  '- หน้าเว็บของเกมเขียนด้วย Next.js และ React เป็นหลัก [[sources/stack.md]]',
  '- ทีมเริ่มพัฒนาเกมนี้ในปี 2026 และเปิดใช้งานจริงในเดือนตุลาคม [[sources/stack.md]]',
  '- ระบบรายงานผลใช้ PostgreSQL เป็นที่เก็บข้อมูลของทุกห้องเล่น [[sources/stack.md]]',
].join('\n');

const PAGES: Record<string, { title: string; content: string }> = {
  'topics/arena.md': { title: 'Pika Arena', content: ARENA },
  'systems/stack.md': { title: 'ระบบและเครื่องมือ', content: STACK },
};

const DOCUMENTS = {
  documents: [
    {
      document_id: 'doc-1',
      title: 'คู่มือ Pika Arena.pdf',
      source_ref: 'uploads/arena.pdf',
      doc_date: '2026-10-20',
      ingested_date: '2026-10-21',
      bytes: 48_120,
      pages: [{ file_path: 'topics/arena.md' }, { file_path: 'systems/stack.md' }],
    },
    { document_id: 'doc-2', source_ref: 'uploads/notes.docx', pages: ['topics/arena.md'] },
  ],
  total: 2,
};

const HITS = [
  { file_path: 'topics/arena.md', title: 'Pika Arena', snippet: 'ห้องเล่นหนึ่งห้องรองรับผู้เล่น'.repeat(40), score: 0.91 },
  { file_path: 'topics/arena.md', title: 'Pika Arena', snippet: 'หน้าเดิมจากอีกท่อนหนึ่ง', score: 0.72 },
  { file_path: 'systems/stack.md', title: 'ระบบและเครื่องมือ', snippet: 'Node.js และ pm2' },
  { title: 'ไม่มี path', snippet: 'แถวที่ไม่มีที่อยู่ของหน้า' },
];

// ---------- the fake Pika ----------

interface Call {
  method: string;
  route: string;
  query: URLSearchParams;
  auth: string;
  body: Record<string, unknown>;
}
type Answer = { status?: number; json?: unknown; text?: string; type?: string };

const calls: Call[] = [];
let answer: (c: Call) => Answer;
let server: Server;

const projectOf = (route: string) => /^\/projects\/([^/]+)/.exec(route)?.[1] ?? '';

function pika(c: Call): Answer {
  const id = projectOf(c.route);
  if (c.method === 'POST' && c.route === '/projects') {
    return { status: 201, json: { project_id: c.body.id, client_id: 'client-1', api_key: PROJECT_KEY } };
  }
  if (c.method === 'POST' && c.route === `/projects/${id}/api-keys`) return { status: 201, json: { client_id: 'client-2', api_key: ISSUED_KEY } };
  if (c.method === 'GET' && c.route === `/projects/${id}/documents`) return { json: DOCUMENTS };
  if (c.method === 'POST' && c.route === `/projects/${id}/search`) return { json: { hits: HITS } };
  if (c.method === 'GET' && c.route === `/projects/${id}/pages`) {
    const page = PAGES[c.query.get('path') ?? ''];
    return page ? { json: { file_path: c.query.get('path'), title: page.title, content: page.content } } : { status: 404, json: { detail: 'page not found' } };
  }
  return { status: 404, json: { detail: 'no such route' } };
}

/** The last request of a kind, to check what we actually sent — above all, which key. */
const lastCall = (method: string, ending: string) => [...calls].reverse().find((c) => c.method === method && c.route.endsWith(ending));

// ---------- the person using it ----------

let db: Db;
let user: SessionUser;
let cookie: string;

const req = (url: string, init: RequestInit = {}) =>
  new Request(`http://localhost${url}`, { ...init, headers: { cookie, ...((init.headers as Record<string, string>) ?? {}) } });

const send = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  req(url, {
    method: 'POST',
    headers: { 'x-ib-req': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A route's answer as both text and json: the text is what a log or a browser would really see. */
async function read(res: Response) {
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, any> };
}

/** An expected refusal as one string, so a test can assert the status and the code together. */
async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'no error';
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code}` : `unexpected: ${String(e)}`;
  }
}

before(async () => {
  mkdirSync(path.join(DIR, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(orgKeyFile, `${ORG_KEY}\n`, { encoding: 'utf8', mode: 0o600 });

  server = createServer((request, res) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://fake');
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { raw };
      }
      const call: Call = {
        method: request.method ?? 'GET',
        route: url.pathname.replace('/Pika/api/v1', ''),
        query: url.searchParams,
        auth: request.headers.authorization ?? '',
        body,
      };
      calls.push(call);
      const out = answer(call);
      if (out.text !== undefined) {
        res.writeHead(out.status ?? 200, { 'content-type': out.type ?? 'text/html' });
        res.end(out.text);
      } else {
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.json ?? null));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.PIKA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/Pika/api/v1`;

  db = await getDb();
  user = await upsertUser(db, { issuer: 'mock', subject: 'pika-tester', name: 'สกล', email: EMAIL });
  cookie = `ib_sid=${await createSession(db, user.id)}`;
});

after(async () => {
  await db.close().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    rmSync(DIR, { recursive: true, force: true });
  } catch {
    // a database file still open on Windows: the folder is in the system temp anyway
  }
});

beforeEach(() => {
  answer = pika;
  calls.length = 0;
});

// ---------- who a project belongs to ----------

describe('the project id', () => {
  test('is the part of the email before the @, lowercased', () => {
    assert.equal(projectIdFor('Sakan_Pu@mfec.co.th'), 'icebreaking_sakan_pu');
    assert.equal(projectIdFor('  First.Last@MFEC.co.th '), 'icebreaking_first_last');
  });

  test('replaces what a url cannot carry rather than dropping it', () => {
    assert.equal(projectIdFor('a+b@x.co'), 'icebreaking_a_b');
    assert.equal(projectIdFor('one..two@x.co'), 'icebreaking_one_two');
  });

  test('refuses an email with nothing usable in front of the @', () => {
    for (const bad of ['@x.co', '...@x.co', '   @x.co', 'ชื่อไทย@x.co']) {
      assert.throws(
        () => projectIdFor(bad),
        (e: unknown) => e instanceof HttpError && e.status === 400 && e.code === 'bad_email',
        bad,
      );
    }
  });
});

describe('redaction', () => {
  test('hides every kind of key, wherever it appears', () => {
    assert.equal(redact(`ใช้คีย์ ${PROJECT_KEY} ไม่ได้`), 'ใช้คีย์ <คีย์ถูกซ่อนไว้> ไม่ได้');
    assert.equal(redact(`${ORG_KEY} then ${ISSUED_KEY}`), '<คีย์ถูกซ่อนไว้> then <คีย์ถูกซ่อนไว้>');
    assert.equal(redact('pika_test_abc-DEF_123'), '<คีย์ถูกซ่อนไว้>');
  });

  test('leaves everything else alone', () => {
    assert.equal(redact('ไม่มีคีย์ในข้อความนี้ pika หรือ pika_live'), 'ไม่มีคีย์ในข้อความนี้ pika หรือ pika_live');
  });
});

// ---------- the key on disk ----------

describe('the project file', () => {
  test('round-trips, and only its owner can read it', () => {
    const p: PikaProject = { projectId: 'icebreaking_rt', clientId: 'c-9', key: PROJECT_KEY, createdAt: 1_700_000_000_000 };
    writeProject(p);
    assert.deepEqual(readProject('icebreaking_rt'), p);
    if (process.platform !== 'win32') {
      assert.equal(statSync(path.join(DIR, 'secrets', 'pika-projects', 'icebreaking_rt.json')).mode & 0o777, 0o600);
      assert.equal(statSync(path.join(DIR, 'secrets', 'pika-projects')).mode & 0o777, 0o700);
    }
  });

  test('reads a file written by hand during setup', () => {
    const file = path.join(DIR, 'secrets', 'pika-projects', 'icebreaking_byhand.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ id: 'icebreaking_byhand', client_id: 'c-1', api_key: PROJECT_KEY, created_at: 42 }));
    assert.deepEqual(readProject('icebreaking_byhand'), { projectId: 'icebreaking_byhand', clientId: 'c-1', key: PROJECT_KEY, createdAt: 42 });
  });

  test('is nothing without a key in it', () => {
    const file = path.join(DIR, 'secrets', 'pika-projects', 'icebreaking_nokey.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ project_id: 'icebreaking_nokey', client_id: 'c-1' }));
    assert.equal(readProject('icebreaking_nokey'), null);
    writeFileSync(file, 'ไม่ใช่ json');
    assert.equal(readProject('icebreaking_nokey'), null);
  });

  test('a project nobody has made reads as null', () => {
    assert.equal(readProject('icebreaking_nobody'), null);
    assert.equal(existingProject('nobody@mfec.co.th'), null);
  });

  test('the org key being there is what turns the feature on', () => {
    assert.equal(pikaConfigured(), true);
  });
});

// ---------- making a project ----------

describe('making a project', () => {
  test('uses the org key, names the person as the owner, and keeps the key it gets back', async () => {
    const project = await ensureProject('alice@mfec.co.th', 'Alice');
    assert.equal(project.projectId, 'icebreaking_alice');
    assert.equal(project.key, PROJECT_KEY);
    assert.equal(project.clientId, 'client-1');
    assert.ok(project.createdAt > 0);

    const create = lastCall('POST', '/projects');
    assert.equal(create?.auth, `Bearer ${ORG_KEY}`);
    assert.equal(create?.body.id, 'icebreaking_alice');
    // the full email, so the person can open the project in Pika themselves
    assert.equal(create?.body.owner_username, 'alice@mfec.co.th');
    assert.equal(create?.body.name, 'IceBreaking Alice');

    // kept on disk, so asking again costs no request at all
    assert.deepEqual(readProject('icebreaking_alice'), project);
    calls.length = 0;
    assert.deepEqual(await ensureProject('alice@mfec.co.th'), project);
    assert.equal(calls.length, 0);
  });

  test('asks for a key of its own when the project is already there', async () => {
    answer = (c) => (c.route === '/projects' ? { status: 200, json: { project_id: c.body.id, detail: 'already exists' } } : pika(c));
    const project = await ensureProject('bob@mfec.co.th');
    assert.equal(project.key, ISSUED_KEY);
    assert.equal(project.clientId, 'client-2');
    assert.equal(lastCall('POST', '/api-keys')?.auth, `Bearer ${ORG_KEY}`);
    assert.equal(lastCall('POST', '/api-keys')?.body.name, 'Pika Arena');
  });

  test('refuses rather than storing a project with no key', async () => {
    answer = () => ({ json: { detail: 'ok' } });
    assert.equal(await refusal(() => ensureProject('carol@mfec.co.th')), '502 pika_failed');
    assert.equal(readProject('icebreaking_carol'), null);
  });

  test('without the org key the feature is simply off', async () => {
    rmSync(orgKeyFile);
    try {
      assert.equal(pikaConfigured(), false);
      assert.equal(await refusal(() => ensureProject('dave@mfec.co.th')), '503 pika_off');
      assert.equal(calls.length, 0);
    } finally {
      writeFileSync(orgKeyFile, `${ORG_KEY}\n`, { encoding: 'utf8', mode: 0o600 });
    }
  });
});

// ---------- every answer Pika can give ----------

describe('when Pika answers badly', () => {
  const p: PikaProject = { projectId: 'icebreaking_errors', clientId: null, key: PROJECT_KEY, createdAt: 1 };

  test('a status becomes the refusal a person can act on', async () => {
    for (const [status, expected] of [
      [401, '502 pika_denied'],
      [403, '502 pika_denied'],
      [404, '404 pika_not_found'],
      [429, '429 pika_busy'],
      [500, '502 pika_failed'],
      [503, '502 pika_failed'],
    ] as const) {
      answer = () => ({ status, json: { detail: `key ${PROJECT_KEY} rejected` } });
      assert.equal(await refusal(() => listDocuments(p)), expected, `status ${status}`);
    }
  });

  test('a page of html instead of json is a failure, not a page', async () => {
    answer = () => ({ text: '<html>504 Gateway Time-out</html>' });
    assert.equal(await refusal(() => readPage(p, 'topics/arena.md')), '502 pika_failed');
  });

  test('an empty answer is simply nothing', async () => {
    answer = () => ({ text: '' });
    assert.equal(await readPage(p, 'topics/arena.md'), null);
    assert.deepEqual(await listDocuments(p), { documents: [], total: 0 });
  });

  test('a knowledge base that is not answering says so', async () => {
    const base = process.env.PIKA_BASE_URL;
    process.env.PIKA_BASE_URL = 'http://127.0.0.1:1/Pika/api/v1';
    try {
      assert.equal(await refusal(() => listDocuments(p)), '502 pika_unreachable');
    } finally {
      process.env.PIKA_BASE_URL = base;
    }
  });
});

// ---------- reading what is in there ----------

describe('reading a project', () => {
  const p: PikaProject = { projectId: PROJECT, clientId: null, key: PROJECT_KEY, createdAt: 1 };

  test('documents come back with the pages they became', async () => {
    const { documents, total } = await listDocuments(p, { limit: 50, offset: 0 });
    assert.equal(total, 2);
    assert.equal(documents.length, 2);
    assert.deepEqual(documents[0], {
      documentId: 'doc-1',
      title: 'คู่มือ Pika Arena.pdf',
      sourceRef: 'uploads/arena.pdf',
      docDate: '2026-10-20',
      ingestedDate: '2026-10-21',
      bytes: 48_120,
      pages: ['topics/arena.md', 'systems/stack.md'],
    });
    // a document with no title of its own is shown by where it came from
    assert.equal(documents[1].title, 'uploads/notes.docx');
    assert.equal(documents[1].bytes, null);
    // and it is the project's own key that reads it, never the org key
    assert.equal(lastCall('GET', '/documents')?.auth, `Bearer ${PROJECT_KEY}`);
    assert.equal(lastCall('GET', '/documents')?.query.get('limit'), '50');
  });

  test('a bare list is a list too', async () => {
    answer = () => ({ json: [{ id: 'doc-9', name: 'บันทึกการประชุม' }] });
    const { documents, total } = await listDocuments(p, { limit: 50, offset: 100 });
    assert.equal(documents[0].documentId, 'doc-9');
    assert.equal(documents[0].title, 'บันทึกการประชุม');
    // no total in the answer: what we have seen so far, so the page after this one is still offered
    assert.equal(total, 101);
  });

  test('search gives one row per page, short enough to show', async () => {
    const hits = await searchPages(p, 'ห้องเล่น');
    assert.deepEqual(
      hits.map((h) => h.path),
      ['topics/arena.md', 'systems/stack.md'],
    );
    assert.ok(hits[0].snippet.length <= 400);
    assert.equal(hits[0].score, 0.91);
    assert.equal(hits[1].score, null);
    const search = lastCall('POST', '/search');
    assert.equal(search?.auth, `Bearer ${PROJECT_KEY}`);
    assert.deepEqual(search?.body, { query: 'ห้องเล่น', top_k: 10 });
  });

  test('a page comes back as the markdown it is', async () => {
    const page = await readPage(p, 'topics/arena.md');
    assert.equal(page?.path, 'topics/arena.md');
    assert.equal(page?.title, 'Pika Arena');
    assert.ok(page?.content.includes('## Details'));
    assert.equal(lastCall('GET', '/pages')?.query.get('path'), 'topics/arena.md');
  });

  test('a page under another name for its text still reads', async () => {
    answer = () => ({ json: { path: 'x.md', markdown: '# x\n\n## Details\n- หนึ่งข้อเท็จจริงที่ยาวพอจะตั้งคำถามได้จริง' } });
    assert.equal((await readPage(p, 'x.md'))?.content.includes('ข้อเท็จจริง'), true);
  });

  test('a page that is not there is a refusal with its own status', async () => {
    assert.equal(await refusal(() => readPage(p, 'topics/ไม่มีหน้านี้.md')), '404 pika_not_found');
  });
});

// ---------- the routes a browser calls ----------

describe('the project route', () => {
  test('says the feature is on and the person has no project yet', async () => {
    const { status, body } = await read(await projectGET(req('/api/pika/project')));
    assert.equal(status, 200);
    assert.deepEqual(body, { configured: true, hasEmail: true, projectId: null });
  });

  test('refuses to make one unless the page asked', async () => {
    const { status, body } = await read(await projectPOST(new Request('http://localhost/api/pika/project', { method: 'POST', headers: { cookie } })));
    assert.equal(status, 403);
    assert.equal(body.error, 'forbidden');
  });

  test('refuses to work at all without a session', async () => {
    const { status, body } = await read(await projectGET(new Request('http://localhost/api/pika/project')));
    assert.equal(status, 401);
    assert.equal(body.error, 'login_required');
  });

  test('makes the project, and the key stays on the server', async () => {
    const { status, text, body } = await read(await projectPOST(send('/api/pika/project')));
    assert.equal(status, 201);
    assert.deepEqual(body, { projectId: PROJECT });
    assert.ok(!text.includes('pika_live'));
    assert.equal(readProject(PROJECT)?.key, PROJECT_KEY);

    const again = await read(await projectGET(req('/api/pika/project')));
    assert.deepEqual(again.body, { configured: true, hasEmail: true, projectId: PROJECT });
    assert.ok(!again.text.includes('pika_live'));
  });

  test('an account without an email cannot have one', async () => {
    const other = await upsertUser(db, { issuer: 'mock', subject: 'no-email', name: 'ไม่มีอีเมล' });
    const theirs = `ib_sid=${await createSession(db, other.id)}`;
    const res = await projectPOST(new Request('http://localhost/api/pika/project', { method: 'POST', headers: { cookie: theirs, 'x-ib-req': '1' } }));
    const { status, body } = await read(res);
    assert.equal(status, 409);
    assert.equal(body.error, 'no_email');
  });
});

describe('the documents and search routes', () => {
  test('documents are listed a page at a time', async () => {
    const { status, body } = await read(await documentsGET(req('/api/pika/documents')));
    assert.equal(status, 200);
    assert.equal(body.documents.length, 2);
    assert.equal(body.total, 2);
    assert.equal(body.offset, 0);
    assert.equal(body.pageSize, 50);
  });

  test('a nonsense offset is simply the first page', async () => {
    const { body } = await read(await documentsGET(req('/api/pika/documents?offset=-5')));
    assert.equal(body.offset, 0);
    assert.equal(lastCall('GET', '/documents')?.query.get('offset'), '0');
    await documentsGET(req('/api/pika/documents?offset=ห้า'));
    assert.equal(lastCall('GET', '/documents')?.query.get('offset'), '0');
  });

  test('a search needs something to search for', async () => {
    const { status, body } = await read(await searchPOST(send('/api/pika/search', { query: 'ก' })));
    assert.equal(status, 400);
    assert.equal(body.error, 'bad_query');
  });

  test('a search answers with the pages, and never puts the question in a url', async () => {
    const { status, body } = await read(await searchPOST(send('/api/pika/search', { query: 'ห้องเล่นรองรับกี่คน' })));
    assert.equal(status, 200);
    assert.equal(body.hits.length, 2);
    const search = lastCall('POST', '/search');
    assert.equal(search?.query.toString(), '');
    assert.equal(search?.body.query, 'ห้องเล่นรองรับกี่คน');
  });
});

describe('the review screen', () => {
  let facts: Record<string, any>[] = [];

  test('turns chosen pages into facts, and says what it left out and why', async () => {
    const { status, text, body } = await read(
      await factsPOST(send('/api/pika/facts', { paths: ['topics/arena.md', 'systems/stack.md', 'topics/ไม่มีหน้านี้.md', 'topics/arena.md'] })),
    );
    assert.equal(status, 200);
    facts = body.facts;

    // the page that is gone is named, and the other two are still read
    assert.deepEqual(body.missing, ['topics/ไม่มีหน้านี้.md']);
    assert.deepEqual(
      body.pages.map((p: any) => [p.path, p.title, p.kept]),
      [
        ['topics/arena.md', 'Pika Arena', 3],
        ['systems/stack.md', 'ระบบและเครื่องมือ', 3],
      ],
    );
    assert.ok(body.pages[0].summary.startsWith('Pika Arena เป็นเกมตอบคำถาม'));

    assert.equal(facts.length, 6);
    assert.deepEqual(facts[0], {
      id: 'f1',
      page: 'topics/arena.md',
      pageTitle: 'Pika Arena',
      cite: 'sources/arena-notes.md',
      text: 'ห้องเล่นหนึ่งห้องรองรับผู้เล่นพร้อมกันได้ 1000 คน',
      type: 'slider',
    });
    // the bold is gone with the rest of the markdown
    assert.ok(facts[1].text.includes('Socket.IO') && !facts[1].text.includes('*'));

    // dropped in the order a reader meets them, each with words to show
    assert.deepEqual(
      body.dropped.map((d: any) => d.why),
      ['contact', 'short', 'per-page'],
    );
    assert.equal(body.dropped[0].reason, 'มีข้อมูลติดต่อ (อีเมลหรือเบอร์โทร)');
    // the reason is shown, the words are not: they are somebody's email address
    assert.equal(body.dropped[0].text, null);
    assert.equal(body.dropped[1].text, 'สั้นไป');
    assert.equal(body.dropped[2].page, 'systems/stack.md');

    // nothing anybody could be contacted through leaves the server
    assert.ok(!text.includes('support@example.com'));
    assert.ok(!text.includes('pika_live'));
  });

  test('a page has to be chosen, and not too many', async () => {
    assert.equal((await read(await factsPOST(send('/api/pika/facts', { paths: [] })))).body.error, 'no_pages');
    assert.equal((await read(await factsPOST(send('/api/pika/facts', { paths: ['  ', 7] })))).body.error, 'no_pages');
    const many = Array.from({ length: MAX_PAGES + 1 }, (_, i) => `page-${i}.md`);
    const { status, body } = await read(await factsPOST(send('/api/pika/facts', { paths: many })));
    assert.equal(status, 400);
    assert.equal(body.error, 'too_many_pages');
    assert.equal(calls.length, 0);
  });

  test('pages with nothing to ask about say so instead of building an empty game', async () => {
    answer = (c) => (c.route.endsWith('/pages') ? { json: { file_path: 'empty.md', title: 'ว่าง', content: '# ว่าง\n\n## Details\n- สั้น' } } : pika(c));
    const { status, body } = await read(await factsPOST(send('/api/pika/facts', { paths: ['empty.md'] })));
    assert.equal(status, 409);
    assert.equal(body.error, 'no_facts');
    assert.equal(body.dropped, 1);
  });

  test('the facts become a game that is the owner’s alone', async () => {
    const { status, text, body } = await read(
      await draftPOST(send('/api/pika/draft', { title: 'ควิซจากคลังความรู้ของทีม', facts: facts.map(({ id, ...rest }) => rest) })),
    );
    assert.equal(status, 201);
    const record = body.game;
    assert.equal(record.tainted, true);
    assert.equal(record.origin, 'pika');

    const game = record.game as Game;
    assert.equal(game.title, 'ควิซจากคลังความรู้ของทีม');
    const questions = game.rounds.flatMap((r) => r.questions);
    assert.ok(questions.length >= 5, `only ${questions.length} questions`);
    assert.deepEqual(
      game.rounds.map((r) => r.title),
      ['Pika Arena', 'ระบบและเครื่องมือ'],
    );
    const checked = validateGame(game);
    assert.ok(checked.ok, JSON.stringify(checked));

    // every question says where it came from and what the answer was
    for (const q of questions) {
      assert.ok(q.source?.path === 'topics/arena.md' || q.source?.path === 'systems/stack.md', JSON.stringify(q.source));
      assert.ok((q.explanation ?? '').length > 0, `no explanation on ${q.id}`);
    }
    assert.ok(!text.includes('support@example.com'));
    assert.ok(!text.includes('pika_live'));

    // it is in the person's own games, and it can never be shared
    const mine = await listGames(db, user.id);
    assert.equal(mine.filter((g) => g.origin === 'pika').length, 1);
    assert.deepEqual(await shareGame(db, user, record.id), { ok: false, reason: 'tainted' });
  });

  test('a draft needs facts that are really facts', async () => {
    assert.equal((await read(await draftPOST(send('/api/pika/draft', { facts: [] })))).body.error, 'no_facts');
    assert.equal((await read(await draftPOST(send('/api/pika/draft', { facts: [{ text: 'ไม่มีหน้า' }, 'ไม่ใช่ข้อเท็จจริง'] })))).body.error, 'no_facts');
    const { status, body } = await read(
      await draftPOST(send('/api/pika/draft', { facts: Array.from({ length: 300 }, () => ({ text: 'x', page: 'p.md' })) })),
    );
    assert.equal(status, 400);
    assert.equal(body.error, 'too_long');
  });

  test('nothing can be read or built without a project of one’s own', async () => {
    const other = await upsertUser(db, { issuer: 'mock', subject: 'no-project', name: 'ยังไม่มีโปรเจกต์', email: 'zoe@mfec.co.th' });
    const theirs = `ib_sid=${await createSession(db, other.id)}`;
    const as = (url: string, body?: unknown) =>
      new Request(`http://localhost${url}`, {
        method: 'POST',
        headers: { cookie: theirs, 'x-ib-req': '1', 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    assert.equal((await read(await searchPOST(as('/api/pika/search', { query: 'อะไรก็ได้' })))).body.error, 'no_project');
    assert.equal((await read(await factsPOST(as('/api/pika/facts', { paths: ['topics/arena.md'] })))).body.error, 'no_project');
    assert.equal((await read(await draftPOST(as('/api/pika/draft', { facts: [{ text: 'x', page: 'p.md' }] })))).body.error, 'no_project');
    assert.equal(
      (await read(await documentsGET(new Request('http://localhost/api/pika/documents', { headers: { cookie: theirs } })))).body.error,
      'no_project',
    );
    assert.equal(calls.length, 0);
  });
});
