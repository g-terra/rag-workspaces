import { folders, type Database } from '@rag/db';
import { and, eq } from 'drizzle-orm';
import { HttpProblem } from '../errors.js';

/** The id of a folder in this workspace, or a 404: a folder from elsewhere is never silently empty. */
export async function requireFolder(db: Database, workspaceId: string, folderId: string): Promise<string> {
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.workspaceId, workspaceId), eq(folders.id, folderId)));
  if (!row) throw new HttpProblem(404, `No folder ${folderId} in this workspace`);
  return row.id;
}
