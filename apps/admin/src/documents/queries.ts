import type { Document } from '@rag/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';
import { applyDocumentEvent, filenameFromDisposition } from './library';
import { useDocumentEvents } from './use-document-events';

const documentsKey = (slug: string) => ['workspaces', slug, 'documents'];
const documentsPath = (slug: string) => `/v1/workspaces/${encodeURIComponent(slug)}/documents`;

/** The workspace's documents, newest first, kept current by the status stream while mounted. */
export function useLiveDocuments(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  useDocumentEvents(slug, (event) =>
    queryClient.setQueryData<Document[]>(
      documentsKey(slug),
      (list) => list && applyDocumentEvent(list, event),
    ),
  );
  return useQuery({
    queryKey: documentsKey(slug),
    queryFn: async () => (await api<{ data: Document[] }>(documentsPath(slug))).data,
  });
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

/**
 * Downloads the original file. A plain link can't send the bearer token, so this fetches it, then saves
 * the blob under the name from `content-disposition`.
 */
export function useDownloadDocument(slug: string) {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (doc: Document) => {
      const token = await getToken();
      const res = await fetch(`/api${documentsPath(slug)}/${encodeURIComponent(doc.id)}/file`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail ?? res.statusText);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFromDisposition(res.headers.get('content-disposition')) ?? doc.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}
