import type { Document, Transcript } from '@rag/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';
import type { DocumentEvent } from './events';
import { applyDocumentEvent } from './library';
import { useDocumentEvents } from './use-document-events';

export const documentsKey = (slug: string) => ['workspaces', slug, 'documents'];
const documentsPath = (slug: string) => `/v1/workspaces/${encodeURIComponent(slug)}/documents`;

/** The workspace's documents, newest first, kept current by the status stream while mounted. */
export function useLiveDocuments(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  useDocumentEvents(slug, (event) => void applyToLibrary(queryClient, slug, event));
  return useQuery({
    queryKey: documentsKey(slug),
    queryFn: async () => (await api<{ data: Document[] }>(documentsPath(slug))).data,
  });
}

/**
 * Applies one stream event to the cached list. A snapshot also reloads the list: it holds only unfinished
 * documents, so it can't show what finished or was deleted while the stream was down, and it covers
 * events that arrived while the first load was still pending (the cache was empty then).
 */
export function applyToLibrary(queryClient: QueryClient, slug: string, event: DocumentEvent) {
  queryClient.setQueryData<Document[]>(documentsKey(slug), (list) => list && applyDocumentEvent(list, event));
  if (event.type === 'snapshot') return queryClient.invalidateQueries({ queryKey: documentsKey(slug) });
}

export function useReindexDocument(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<Document>(`${documentsPath(slug)}/${encodeURIComponent(id)}/reindex`, { method: 'POST' }),
    onSuccess: (document) =>
      queryClient.setQueryData<Document[]>(
        documentsKey(slug),
        (list) => list && applyDocumentEvent(list, { type: 'document', document }),
      ),
  });
}

export function useDeleteDocument(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`${documentsPath(slug)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_, id) =>
      queryClient.setQueryData<Document[]>(
        documentsKey(slug),
        (list) => list && applyDocumentEvent(list, { type: 'removed', id }),
      ),
  });
}

/** The original file, fetched with the bearer token a plain link or frame can't send. */
async function fetchFile(
  slug: string,
  id: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`/api${documentsPath(slug)}/${encodeURIComponent(id)}/file`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? res.statusText);
  }
  return res.blob();
}

/**
 * Downloads the original file: fetches it, then saves the blob under the document's `fileName`.
 */
export function useDownloadDocument(slug: string) {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (doc: Document) => {
      const url = URL.createObjectURL(await fetchFile(slug, doc.id, await getToken()));
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}

/**
 * A video or audio document's transcript. Its key sits beside the documents list, not under it, so the
 * list's reload on every status-stream snapshot doesn't fetch a long transcript again.
 */
export function useTranscript(slug: string, documentId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['workspaces', slug, 'transcripts', documentId],
    queryFn: () => api<Transcript>(`${documentsPath(slug)}/${encodeURIComponent(documentId)}/transcript`),
  });
}

/**
 * The original file as a blob, for the in-app preview. Cached per document, so opening a second
 * citation from the same PDF doesn't download it again. `id` null fetches nothing.
 */
export function useDocumentFile(slug: string, id: string | null) {
  const { getToken } = useAuth();
  return useQuery({
    // Not under documentsKey: a library refresh invalidates that, and must not download the file again.
    queryKey: ['workspaces', slug, 'document-file', id],
    queryFn: async ({ signal }) => fetchFile(slug, id!, await getToken(), signal),
    enabled: id !== null,
    staleTime: Infinity,
  });
}
