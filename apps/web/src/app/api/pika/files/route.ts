import { requireUser } from '@/server/auth';
import { HttpError, guardMutation, handle, json } from '@/server/http';
import { INGEST_MAX_BYTES, INGEST_TYPES, existingProject, ingestFile } from '@/server/pika';
import { cleanFileName, idempotencyKeyOf, ingestType, withIngestSlot } from '@/server/pika-ingest';

/** room for the multipart framing and the two short fields around the file */
const FORM_OVERHEAD = 64 * 1024;
const BODY_MAX = INGEST_MAX_BYTES + FORM_OVERHEAD;

/**
 * The form, read with a ceiling: a declared length past it is refused unread, and a body that
 * declares nothing (chunked) is cut off the moment it passes it, so no upload can fill the memory.
 */
async function readForm(req: Request, type: string): Promise<FormData> {
  const tooBig = () => new HttpError(413, 'file_too_big', { maxBytes: INGEST_MAX_BYTES });
  if (Number(req.headers.get('content-length') ?? 0) > BODY_MAX) throw tooBig();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader!.read()) {
    size += part.value.byteLength;
    if (size > BODY_MAX) {
      await reader!.cancel();
      throw tooBig();
    }
    chunks.push(part.value);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { 'content-type': type } }).formData();
  } catch {
    throw new HttpError(400, 'bad_form');
  }
}

/**
 * A file from the person's computer, handed to their own project to learn. Pika reads it in the
 * background, so this answers with the job to follow, not with pages.
 */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const user = await requireUser(req);
    if (!user.email?.includes('@')) throw new HttpError(409, 'no_email');
    const project = existingProject(user.email);
    if (!project) throw new HttpError(409, 'no_project');

    const type = req.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'form_required');
    const form = await readForm(req, type);
    const file = form.get('file');
    if (!(file instanceof Blob) || !('name' in file)) throw new HttpError(400, 'no_file');
    const name = cleanFileName(String((file as File).name ?? ''));
    if (!name || !ingestType(name, INGEST_TYPES)) throw new HttpError(415, 'file_type', { types: INGEST_TYPES });
    if (file.size === 0) throw new HttpError(400, 'empty_file');
    if (file.size > INGEST_MAX_BYTES) throw new HttpError(413, 'file_too_big', { maxBytes: INGEST_MAX_BYTES });
    const title = (typeof form.get('title') === 'string' ? String(form.get('title')) : '').trim().slice(0, 200);
    const idempotencyKey = idempotencyKeyOf(form.get('key'), user.id);

    const job = await withIngestSlot(user.id, () => ingestFile(project, file, name, { title: title || undefined, idempotencyKey }));
    return json({ job }, 202);
  });
}
