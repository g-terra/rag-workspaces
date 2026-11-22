import type { Me } from '@rag/shared';
import type { User } from 'oidc-client-ts';
import { createContext, use } from 'react';
import type { ApiFetch } from '@/api/client';
import type { TokenSource } from './authorized';

export type MeUser = Extract<Me, { kind: 'user' }>;

/** `getToken`, `renewToken` and `endSession` are for requests `api` can't make (uploads, streams). */
export interface AuthContextValue extends TokenSource {
  /** Null when signed out; undefined while the stored session is still being read. */
  user: User | null | undefined;
  /** The caller as the API sees them (name, isAdmin); null until loaded. */
  me: MeUser | null;
  /** Why `GET /v1/me` failed, if it did. */
  meError: string | null;
  /** `fetch` for the API, with the bearer token. */
  api: ApiFetch;
  signIn(returnTo: string): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
