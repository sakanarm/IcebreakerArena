import { FACT_MAX_CHARS, LIMITS, QUESTION_TYPES, buildGame, type FactPlan, type QuestionType } from '@pika-arena/shared';
import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { TooManyGames, createPikaGame, normalizeDraft } from '@/server/games';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { existingProject } from '@/server/pika';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** One reviewed fact, as the review screen sends it back: the page's own words and the type chosen for it. */
function planOf(v: unknown): FactPlan | null {
  if (!isObj(v)) return null;
  const text = str(v.text, FACT_MAX_CHARS);
  const page = str(v.page, LIMITS.sourcePathMax);
  if (!text || !page) return null;
  const pageTitle = str(v.pageTitle, LIMITS.titleMax);
  const cite = str(v.cite, LIMITS.sourceCiteMax);
  const type = QUESTION_TYPES.includes(v.type as QuestionType) ? (v.type as QuestionType) : 'truefalse';
  return { text, page, type, ...(pageTitle ? { pageTitle } : {}), ...(cite ? { cite } : {}) };
}

/**
 * The game the reviewed facts make, saved to the person's own games and opened in the editor.
 * The facts come back from the browser rather than being read again: what a person approved on the
 * review screen is exactly what gets built, and nothing here can reach a page they did not choose.
 */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
    const project = existingProject(user.email);
    if (!project) throw new HttpError(409, 'no_project');

    const body = await readJson(req, 256 * 1024);
    const sent = Array.isArray(body.facts) ? body.facts : [];
    if (sent.length > LIMITS.questionsMax) throw new HttpError(400, 'too_long');
    const plans = sent.map(planOf).filter((p): p is FactPlan => p !== null);
    if (plans.length === 0) throw new HttpError(400, 'no_facts');

    const { game, failed } = buildGame(plans, {
      title: str(body.title, LIMITS.titleMax),
      description: str(body.description, LIMITS.descriptionMax),
      ...(body.style === 'exam' ? { style: 'exam' as const } : {}),
    });
    const draft = normalizeDraft(game);
    if (!draft || draft.rounds.every((r) => r.questions.length === 0)) throw new HttpError(409, 'no_facts');

    try {
      const record = await createPikaGame(await getDb(), user.id, draft, project.projectId);
      // the facts that could not become a question are named, so nobody wonders where they went
      return json({ game: record, failed: failed.map((f) => ({ page: f.page, text: f.text })) }, 201);
    } catch (e) {
      if (e instanceof TooManyGames) throw new HttpError(409, 'too_many_games');
      throw e;
    }
  });
}
