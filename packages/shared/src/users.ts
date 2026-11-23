import { z } from 'zod';

/** `GET /v1/users`: one person in Keycloak's rag-workspaces realm. */
export const User = z.object({
  /** The Keycloak user id: the `userId` used by workspace members. */
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  /** Has the realm role `admin`. */
  isAdmin: z.boolean(),
  /** Disabled accounts cannot sign in, but can still be listed as members. */
  enabled: z.boolean(),
});
export type User = z.infer<typeof User>;

export const UserQuery = z.object({
  /** Matches username, email, first or last name (Keycloak's own search). */
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().regex(/^\d+$/, 'not a cursor from this list').optional(),
});
export type UserQuery = z.infer<typeof UserQuery>;
