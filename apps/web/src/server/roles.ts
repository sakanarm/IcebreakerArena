import type { SessionUser } from './session';

/**
 * What an account may do. Everyone is a maker; a curator may also take down anything in the shared
 * catalog; an admin may do that and run the admin page (users, roles, permissions, AI settings).
 * On top of the role an admin can turn single features off for one account (perms), for example
 * sharing for someone who shared what they should not have. Nothing here touches what players can do:
 * they never log in.
 */
export const ROLES = ['maker', 'curator', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);

/** features an admin can turn off for one account; all are on unless turned off */
export const PERMS = ['share', 'aiQuiz', 'pika'] as const;
export type Perm = (typeof PERMS)[number];
export type Perms = Record<Perm, boolean>;

/** what is stored: only the features turned off, so a feature added later starts on for everyone */
export function readPerms(raw: unknown): Perms {
  const off = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(PERMS.map((p) => [p, off[p] !== false])) as Perms;
}

export const storedPerms = (can: Perms): Record<string, false> =>
  Object.fromEntries(PERMS.filter((p) => !can[p]).map((p) => [p, false])) as Record<string, false>;

/** the columns every login reads, in the shape toSessionUser takes */
export const USER_COLUMNS = 'id, display_name, email, role, perms, disabled';

export interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  perms: unknown;
  disabled: boolean;
}

export function toSessionUser(u: UserRow): SessionUser {
  const role: Role = isRole(u.role) ? u.role : 'maker';
  return { id: u.id, name: u.display_name, email: u.email, role, isCurator: role !== 'maker', can: readPerms(u.perms) };
}

/** What a browser is told about the person logged in: no email, nothing it does not need. */
export const publicUser = (u: SessionUser) => ({ id: u.id, name: u.name, role: u.role, isCurator: u.isCurator, can: u.can });
