import { requirePerm, requireUser } from '@/server/auth';
import { HttpError, guardMutation, handle, json, readJson } from '@/server/http';
import { INGEST_TEXT_MAX, existingProject, ingestText } from '@/server/pika';
import { idempotencyKeyOf, withIngestSlot } from '@/server/pika-ingest';
import { hasContactInfo } from '@pika-arena/shared';

/** Thai is three bytes a character in UTF-8, and JSON escapes add a little more */
const BODY_MAX = INGEST_TEXT_MAX * 4 + 4096;
/** shorter than this is a note, and a note makes no exam */
const TEXT_MIN = 200;

/** Text someone pasted (notes, a policy, a chapter), learned the same way a file is. */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    requirePerm(user, 'pika');
    if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
    const project = existingProject(user.email);
    if (!project) throw new HttpError(409, 'no_project');

    const body = await readJson(req, BODY_MAX);
    const content = (typeof body.content === 'string' ? body.content : '').replace(/\r\n?/g, '\n').trim();
    const title = (typeof body.title === 'string' ? body.title : '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) throw new HttpError(400, 'no_title');
    if (content.length < TEXT_MIN) throw new HttpError(400, 'text_too_short', { min: TEXT_MIN });
    if (content.length > INGEST_TEXT_MAX) throw new HttpError(413, 'text_too_long', { max: INGEST_TEXT_MAX });
    const idempotencyKey = idempotencyKeyOf(body.key, user.id);

    const job = await withIngestSlot(user.id, () => ingestText(project, { title, content, idempotencyKey }));
    // a paste that carries phone numbers or emails still goes in (it is the person's own project),
    // but the page says so: those lines never become questions
    return json({ job, hasContact: hasContactInfo(content) }, 202);
  });
}
