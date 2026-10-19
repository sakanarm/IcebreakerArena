import type { Sql } from './db';

/** Who did what to which record: logins, shares, withdrawals, reports. Never game content or secrets. */
export async function audit(sql: Sql, userId: string | null, action: string, target: string | null = null, detail: Record<string, unknown> | null = null) {
  await sql.query('INSERT INTO ib_audit_log (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [
    userId,
    action,
    target,
    detail ? JSON.stringify(detail) : null,
  ]);
}
