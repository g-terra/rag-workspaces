import { compositeSources, workspaces, type Database, type Workspace } from '@rag/db';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { requireWorkspace } from '../auth/access.js';
import { HttpProblem } from '../errors.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A composite's source workspaces, in order. Empty for a standard workspace. */
export async function sourcesOf(db: Database | Tx, workspace: Workspace): Promise<Workspace[]> {
  if (workspace.kind !== 'composite') return [];
  const rows = await db
    .select({ workspace: workspaces })
    .from(compositeSources)
    .innerJoin(workspaces, eq(workspaces.id, compositeSources.sourceId))
    .where(eq(compositeSources.compositeId, workspace.id))
    .orderBy(asc(compositeSources.position));
  return rows.map((r) => r.workspace);
}

/**
 * Point a composite at these sources (slugs, already checked to be 2–10 and distinct), replacing
 * any it had. Each must be an existing standard workspace: composites of composites are refused.
 */
export async function setSources(tx: Tx, composite: Workspace, slugs: string[]): Promise<void> {
  const found = await tx.select().from(workspaces).where(inArray(workspaces.slug, slugs));
  const bySlug = new Map(found.map((w) => [w.slug, w]));
  for (const slug of slugs) {
    const source = bySlug.get(slug);
    if (!source) throw new HttpProblem(400, `No workspace "${slug}" to use as a source.`);
    if (source.kind !== 'standard')
      throw new HttpProblem(400, `"${slug}" is a composite; only standard workspaces can be sources.`);
  }
  await tx.delete(compositeSources).where(eq(compositeSources.compositeId, composite.id));
  await tx.insert(compositeSources).values(
    slugs.map((slug, position) => ({
      compositeId: composite.id,
      sourceId: bySlug.get(slug)!.id,
      position,
    })),
  );
}

/** For routes that only make sense for a workspace with documents of its own. */
export function requireStandard(workspace: Workspace): void {
  if (workspace.kind === 'composite')
    throw new HttpProblem(
      409,
      `"${workspace.slug}" is a composite workspace: it has no documents of its own. Use its source workspaces.`,
    );
}

/**
 * A `preHandler` for a plugin whose routes all need documents of their own (documents, folders): a
 * composite answers 409. Access is checked first, so a caller with none still gets 404.
 */
export function standardOnly(db: Database) {
  return async (req: FastifyRequest) => {
    const slug = (req.params as { slug?: string }).slug;
    if (!slug) return;
    const { workspace } = await requireWorkspace(db, req.principal, slug, 'reader');
    requireStandard(workspace);
  };
}
