import { aiUsage } from '@/server/ai-settings';
import { recentChanges, siteCounts } from '@/server/admin';
import { requireAdmin } from '@/server/auth';
import { authMode, authModeProblem, authModeSource, databaseUrl, ssoSource } from '@/server/config';
import { SCHEMA_VERSION, getDb } from '@/server/db';
import { handle, json } from '@/server/http';
import { pikaConfigured } from '@/server/pika';

/** The admin page's system tab: how the site is set up, what is in it, AI use this week, and recent admin changes. */
export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const db = await getDb();
    const sso = ssoSource();
    const [counts, usage, changes] = await Promise.all([siteCounts(db), aiUsage(db), recentChanges(db)]);
    return json({
      system: {
        authMode: authMode(),
        authProblem: authModeProblem(authModeSource()),
        sso: sso.config !== null,
        ssoProblem: sso.problem,
        pika: pikaConfigured(),
        database: databaseUrl() ? 'postgres' : 'pglite',
        schemaVersion: SCHEMA_VERSION,
        node: process.version,
      },
      counts,
      usage,
      changes,
    });
  });
}
