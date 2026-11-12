import { testAi } from '@/server/ai-settings';
import { audit } from '@/server/audit';
import { requireAdmin } from '@/server/auth';
import { getDb } from '@/server/db';
import { guardMutation, handle, json } from '@/server/http';

/** One tiny call with the saved AI settings, to see that the address, key and model work. */
export async function POST(req: Request) {
  return handle(async () => {
    guardMutation(req);
    const admin = await requireAdmin(req);
    const result = await testAi();
    await audit(await getDb(), admin.id, 'admin_ai_tested', null, { ok: result.ok, status: result.ok ? 200 : result.status });
    return json({ result });
  });
}
