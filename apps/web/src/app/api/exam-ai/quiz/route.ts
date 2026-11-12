import { aiConfig, asksLeft, doneAsking, reserveAsk, settleAsk, startAsking } from '@/server/ai';
import { QUIZ_LIMITS, QuizAborted, QuizDeclined, quizFromText, readQuizRequest, writeQuiz } from '@/server/ai-quiz';
import { audit } from '@/server/audit';
import { currentUser, requirePerm, requireUser } from '@/server/auth';
import { getDb } from '@/server/db';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';

/**
 * "ให้ AI ออกข้อสอบ" (server/ai-quiz.ts).
 * GET: whether the tab should show, and how many papers this maker has left today.
 * POST: the document's text; the answer is a stream of lines (NDJSON) so the page can show progress and
 * no proxy closes a connection that is quiet for a minute while Claude thinks:
 *   {"t":"start","left":n}  {"t":"progress","done":n}  {"t":"ping"}
 *   then {"t":"done",title,rounds,count,dropped,quotes,left} or {"t":"error",error,...}
 * A refusal before the writing starts (not logged in, quota, too long) is an ordinary JSON error.
 */

/** the papers being written now, on the whole site */
let writing = 0;

const whoFor = (userId: string) => `q:u:${userId}`;

export async function GET(req: Request) {
  return handle(async () => {
    const c = aiConfig();
    if (!c) return json({ enabled: false });
    const { user } = await currentUser(req);
    if (!user) return json({ enabled: true, needsLogin: true });
    // an admin turned it off for this account: no tab (the create page says why, from /auth/me)
    if (!user.can.aiQuiz) return json({ enabled: false });
    const left = await asksLeft(await getDb(), whoFor(user.id), { perPersonPerDay: c.quizPerPersonPerDay });
    return json({ enabled: true, needsLogin: false, left, perDay: c.quizPerPersonPerDay });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const c = aiConfig();
    if (!c) throw new HttpError(404, 'ai_off');
    const user = await requireUser(req);
    requirePerm(user, 'aiQuiz');
    const r = readQuizRequest(await readJson(req, 256 * 1024));

    const db = await getDb();
    const who = whoFor(user.id);
    if (!startAsking(who)) throw new HttpError(429, 'quiz_running');
    if (writing >= QUIZ_LIMITS.atOnce) {
      doneAsking(who);
      throw new HttpError(503, 'ai_busy');
    }
    // taken before the first await, so two requests can't both see the last free place
    writing++;
    let handedOver = false;
    try {
      const taken = await reserveAsk(db, who, { perPersonPerDay: c.quizPerPersonPerDay, perDay: c.perDay });
      // left: 0 so the page greys the button out at once, though it had counted one more when it loaded
      if (!taken.ok) throw new HttpError(429, 'ai_limit', { scope: taken.reason, perDay: c.quizPerPersonPerDay, left: 0 });

      handedOver = true;
      const stop = new AbortController();
      const leave = () => stop.abort();
      req.signal?.addEventListener('abort', leave);
      const encoder = new TextEncoder();

      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          let open = true;
          const send = (line: Record<string, unknown>) => {
            if (!open) return;
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
            } catch {
              open = false;
            }
          };
          const ping = setInterval(() => send({ t: 'ping' }), 10_000);
          // tokens count as soon as the provider was asked; the paper itself only when one came back
          const settle = async (used: { input: number; output: number } | null, giveBack: boolean) => {
            try {
              if (used && (used.input || used.output)) await settleAsk(db, who, used);
              if (giveBack) await settleAsk(db, who, null);
            } catch (e) {
              console.error('[ai-quiz] could not record usage', e instanceof Error ? e.message : e);
            }
          };
          const leftNow = async () => {
            try {
              return await asksLeft(db, who, { perPersonPerDay: c.quizPerPersonPerDay });
            } catch {
              return undefined;
            }
          };
          try {
            send({ t: 'start', left: taken.left, count: r.count });
            const draft = await writeQuiz(c, r, (done) => send({ t: 'progress', done }), stop.signal);
            const result = quizFromText(draft.text, r.count);
            // nothing usable: the maker keeps the paper, the tokens are still recorded
            await settle(draft.usage, result.count === 0);
            try {
              await audit(db, user.id, 'ai_quiz', null, {
                chars: r.text.length,
                asked: r.count,
                got: result.count,
                dropped: result.dropped,
                level: r.level,
                tokensIn: draft.usage.input,
                tokensOut: draft.usage.output,
              });
            } catch (e) {
              console.error('[ai-quiz] audit', e instanceof Error ? e.message : e);
            }
            if (result.count === 0) send({ t: 'error', error: 'quiz_empty', left: await leftNow() });
            else send({ t: 'done', ...result, left: await leftNow() });
          } catch (e) {
            if (e instanceof QuizAborted) {
              // the maker stopped: free only if the provider had not started yet; once it has read the
              // document the tokens are paid for, and free stops would leave the cost without a ceiling
              await settle(e.usage, !e.usage.input && !e.usage.output);
            } else if (e instanceof QuizDeclined) {
              await settle(e.usage, false);
              send({ t: 'error', error: 'ai_declined', left: await leftNow() });
            } else {
              if (!(e instanceof HttpError)) console.error('[ai-quiz]', e instanceof Error ? `${e.name}: ${e.message}` : e);
              await settle(null, true);
              send({ t: 'error', error: e instanceof HttpError ? e.code : 'server_error', ...(e instanceof HttpError ? e.extra : {}), left: await leftNow() });
            }
          } finally {
            clearInterval(ping);
            req.signal?.removeEventListener('abort', leave);
            writing--;
            doneAsking(who);
            open = false;
            try {
              controller.close();
            } catch {
              // already closed by the browser leaving
            }
          }
        },
        cancel() {
          stop.abort();
        },
      });
      return new Response(body, {
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          // no-transform: a compressing proxy would hold the lines back until the end
          'cache-control': 'no-store, no-transform',
          'x-accel-buffering': 'no',
        },
      });
    } finally {
      if (!handedOver) {
        writing--;
        doneAsking(who);
      }
    }
  });
}
