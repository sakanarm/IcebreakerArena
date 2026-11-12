import { aiSettingsView, saveAiSettings } from '@/server/ai-settings';
import { audit } from '@/server/audit';
import { requireAdmin } from '@/server/auth';
import { getDb } from '@/server/db';
import { guardMutation, handle, json, readJson } from '@/server/http';

/**
 * GET: the AI settings without the secrets (server/ai-settings.ts). PUT: save them; a blank key keeps
 * the one saved. The answer never holds the key or a header value.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    return json({ settings: aiSettingsView() });
  });
}

export async function PUT(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const admin = await requireAdmin(req);
    const { view, changed } = await saveAiSettings(await readJson(req, 32 * 1024));
    // which settings changed, never their values
    await audit(await getDb(), admin.id, 'ai_settings_saved', null, { changed });
    return json({ settings: view });
  });
}
