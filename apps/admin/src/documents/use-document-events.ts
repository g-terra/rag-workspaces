import { useEffect, useEffectEvent, useState } from 'react';
import { useAuth } from '@/auth/auth-context';
import type { DocumentEvent } from './events';
import { followDocumentEvents } from './follow-events';

/**
 * Follows the workspace's document events (`followDocumentEvents`) while the component is mounted,
 * calling `onEvent` for each. Returns why live updates stopped, when the API refused the stream for
 * good (403, 404), else null.
 */
export function useDocumentEvents(slug: string, onEvent: (e: DocumentEvent) => void): string | null {
  const { getToken, renewToken, endSession } = useAuth();
  const emit = useEffectEvent(onEvent);
  const [stopped, setStopped] = useState<{ slug: string; reason: string } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void followDocumentEvents({
      slug,
      auth: { getToken, renewToken, endSession },
      signal: abort.signal,
      onEvent: (e) => emit(e),
      onStop: (reason) => setStopped({ slug, reason }),
    });
    return () => abort.abort();
  }, [slug, getToken, renewToken, endSession]);

  return stopped?.slug === slug ? stopped.reason : null;
}
