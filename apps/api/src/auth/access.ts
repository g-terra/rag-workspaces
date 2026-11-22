import { workspaceMembers, workspaces, type Database, type Workspace } from '@rag/db';
import { and, eq } from 'drizzle-orm';
import { HttpProblem } from '../errors.js';
import type { Principal } from './principal.js';

export type Access = 'admin' | 'editor' | 'reader';
const RANK: Record<Access, number> = { reader: 1, editor: 2, admin: 3 };

/** What a caller may do in a workspace, or `null` for no access at all. */
export async function accessTo(
  db: Database,
  principal: Principal,
  workspace: Workspace,
): Promise<Access | null> {
  if (principal.kind === 'user' && principal.isAdmin) return 'admin';
  if (principal.kind === 'key') {
    return principal.workspaces.some((w) => w.id === workspace.id) ? principal.role : null;
  }
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, principal.id)));
  return member?.role ?? null;
}

/**
 * The one access check every workspace route uses. A caller with no access gets 404, so
 * another workspace's existence is not revealed (docs/api-schema.md, Isolation). A caller
 * with access but too low a role gets 403.
 */
export async function requireWorkspace(
  db: Database,
  principal: Principal | null,
  slug: string,
  need: Access,
): Promise<{ workspace: Workspace; access: Access }> {
  if (!principal) throw new HttpProblem(401, 'Sign in or send an API key.');
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  const access = workspace ? await accessTo(db, principal, workspace) : null;
  if (!workspace || !access) throw new HttpProblem(404, `No workspace "${slug}"`);
  if (RANK[access] < RANK[need]) throw new HttpProblem(403, `This needs the ${need} role in "${slug}".`);
  return { workspace, access };
}
