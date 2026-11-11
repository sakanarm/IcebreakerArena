import { SAMPLE_GAMES, buildExam, toRoomGame, type ExamPaper } from '@pika-arena/shared';
import { dropBlankOptions } from '@/lib/games';
import { Declined, aiConfig, askClaude, askerKey, asksLeft, doneAsking, questionBrief, readTurns, reserveAsk, settleAsk, startAsking } from '@/server/ai';
import { currentUser, requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { readExam } from '@/server/exams';
import { getGame } from '@/server/games';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { isId } from '@/server/session';

/**
 * "ถาม AI" in exam mode (server/ai.ts).
 * GET: whether the button should show, and whether the person must log in first.
 * POST: one more reply in a conversation about one question.
 */

export async function GET(req: Request) {
  return handle(async () => {
    const c = aiConfig();
    if (!c) return json({ enabled: false });
    const { user } = await currentUser(req);
    return json({ enabled: true, needsLogin: c.who === 'signed-in' && !user });
  });
}

/** where the question comes from: the browser names it, the paper itself is always read here */
type PaperRef = { kind: 'sample' | 'link' | 'game'; id: string };

function readRef(value: unknown): PaperRef {
  const r = value as Partial<PaperRef> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !['sample', 'link', 'game'].includes(r.kind as string)) {
    throw new HttpError(400, 'bad_paper');
  }
  return { kind: r.kind as PaperRef['kind'], id: r.id };
}

async function paperFor(req: Request, ref: PaperRef): Promise<ExamPaper> {
  if (ref.kind === 'sample') {
    const sample = SAMPLE_GAMES.find((g) => g.id === ref.id);
    if (sample) return buildExam(toRoomGame(sample));
  } else if (isId(ref.id)) {
    const db = await getDb();
    if (ref.kind === 'link') {
      const exam = await readExam(db, ref.id);
      if (exam) return exam.paper;
    } else {
      // the maker sitting their own game: only they may ask about it
      const user = await requireUser(req);
      const rec = await getGame(db, user.id, ref.id);
      if (rec) return buildExam(dropBlankOptions(rec.game));
    }
  }
  throw new HttpError(404, 'question_gone');
}

export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const c = aiConfig();
    if (!c) throw new HttpError(404, 'ai_off');
    const body = await readJson(req, 128 * 1024);
    const ref = readRef(body.paper);
    const turns = readTurns(body.messages);

    const { user } = await currentUser(req);
    if (c.who === 'signed-in' && !user) throw new HttpError(401, 'login_required');

    const paper = await paperFor(req, ref);
    const topic = paper.topics.find((t) => t.questions.some((q) => q.id === body.questionId));
    const question = topic?.questions.find((q) => q.id === body.questionId);
    if (!topic || !question) throw new HttpError(404, 'question_gone');
    const chosen = body.chosen ?? null;
    if (chosen !== null && !(Number.isInteger(chosen) && (chosen as number) >= 0 && (chosen as number) < question.options.length)) {
      throw new HttpError(400, 'bad_choice');
    }

    const db = await getDb();
    const who = askerKey(req, user?.id ?? null, c.apiKey);
    if (!startAsking(who)) throw new HttpError(429, 'ai_busy');
    try {
      const taken = await reserveAsk(db, who, c);
      if (!taken.ok) throw new HttpError(429, 'ai_limit', { scope: taken.reason });
      try {
        const reply = await askClaude(c, questionBrief(question, topic.title, chosen as number | null), turns);
        await settleAsk(db, who, reply.usage);
        return json({ reply: reply.text, left: taken.left });
      } catch (e) {
        // a refusal still used tokens and still counts; anything else gives the question back
        await settleAsk(db, who, e instanceof Declined ? e.usage : null);
        if (!(e instanceof Declined)) throw e;
        throw new HttpError(422, 'ai_declined', { left: await asksLeft(db, who, c) });
      }
    } finally {
      doneAsking(who);
    }
  });
}
