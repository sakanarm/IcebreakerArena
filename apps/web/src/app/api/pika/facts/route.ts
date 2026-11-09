import { MAX_PAGES, SKIP_REASON, parseWikiPage, planFacts, type SourceFact } from '@pika-arena/shared';
import { requireUser } from '@/server/auth';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { existingProject, readPage, type PikaProject } from '@/server/pika';

/** Pages are read a few at a time: ten at once is a burst the knowledge base doesn't need to take. */
const AT_A_TIME = 4;

async function readAll(project: PikaProject, paths: string[]) {
  const pages: { path: string; title: string; summary: string; facts: SourceFact[] }[] = [];
  const missing: string[] = [];
  for (let i = 0; i < paths.length; i += AT_A_TIME) {
    const batch = await Promise.all(
      paths.slice(i, i + AT_A_TIME).map(async (p) => {
        try {
          return { path: p, page: await readPage(project, p) };
        } catch (e) {
          // one page that cannot be read must not lose the other nine
          if (e instanceof HttpError && e.status === 404) return { path: p, page: null };
          throw e;
        }
      }),
    );
    for (const { path, page } of batch) {
      if (!page) {
        missing.push(path);
        continue;
      }
      const parsed = parseWikiPage(page.content);
      pages.push({
        path: page.path,
        title: page.title,
        summary: parsed.summary,
        facts: parsed.facts.map((f) => ({ ...f, page: page.path, pageTitle: page.title })),
      });
    }
  }
  return { pages, missing };
}

/**
 * What the chosen pages say, as facts, with the question each would become — and what was left out
 * and why. Nothing is saved here: this is the screen a person reads before any game exists.
 */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
    const project = existingProject(user.email);
    if (!project) throw new HttpError(409, 'no_project');

    const body = await readJson(req, 16 * 1024);
    const asked = Array.isArray(body.paths) ? body.paths : [];
    const paths = [...new Set(asked.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim().slice(0, 300)))];
    if (paths.length === 0) throw new HttpError(400, 'no_pages');
    if (paths.length > MAX_PAGES) throw new HttpError(400, 'too_many_pages');

    const { pages, missing } = await readAll(project, paths);
    const { keep, dropped } = planFacts(pages.flatMap((p) => p.facts));
    if (keep.length === 0) throw new HttpError(409, 'no_facts', { missing, dropped: dropped.length });

    return json({
      pages: pages.map((p) => ({
        path: p.path,
        title: p.title,
        summary: p.summary,
        kept: keep.filter((k) => k.page === p.path).length,
      })),
      missing,
      facts: keep.map((f, i) => ({
        id: `f${i + 1}`,
        page: f.page,
        pageTitle: f.pageTitle ?? null,
        cite: f.cite ?? null,
        text: f.text,
        type: f.type,
      })),
      dropped: dropped.map((d) => ({
        page: d.page,
        // a fact held back for an email or a phone number is not read back out: the page it is on
        // and the reason are what the review screen needs, and the words themselves are a person's
        text: d.why === 'contact' ? null : d.text,
        why: d.why,
        reason: SKIP_REASON[d.why],
      })),
    });
  });
}
