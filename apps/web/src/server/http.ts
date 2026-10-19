import { DbUnavailable } from './db';
import { TooLong } from './games';

/** An expected refusal: becomes `{ error: code, ...extra }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/** Runs a route body: expected refusals become JSON errors, anything else is logged and answered with 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
    if (e instanceof TooLong) return json({ error: 'too_long' }, 400);
    if (e instanceof DbUnavailable) {
      console.error('[api]', e.message);
      return json({ error: 'db_unavailable' }, 503);
    }
    console.error('[api]', e);
    return json({ error: 'server_error' }, 500);
  }
}

/**
 * Requests that change something must come from our own pages: a custom header (which a form or a
 * cross-site page can't send without CORS, and we never allow CORS) and no cross-site fetch metadata.
 */
export function guardMutation(req: Request) {
  if (req.headers.get('x-ib-req') !== '1') throw new HttpError(403, 'forbidden');
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new HttpError(403, 'forbidden');
}

/** The JSON body, at most maxBytes, as unknown: callers check every field. */
export async function readJson(req: Request, maxBytes = 512 * 1024): Promise<Record<string, unknown>> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'json_required');
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, 'too_large');
  const chunks: Uint8Array[] = [];
  const reader = req.body?.getReader();
  let size = 0;
  for (let part = await reader?.read(); part && !part.done; part = await reader!.read()) {
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader!.cancel();
      throw new HttpError(413, 'too_large');
    }
    chunks.push(part.value);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_json');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new HttpError(400, 'bad_json');
  return data as Record<string, unknown>;
}
