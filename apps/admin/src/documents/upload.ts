import type { UploadResult } from '@rag/shared';
import { failureDetail } from '@/api/problem';

export type UploadOutcome =
  | { ok: true; status: number; result: UploadResult['data'][number] }
  /** `status` 0: no answer (network error, or aborted). */
  | { ok: false; status: number; detail: string };

/**
 * Uploads one file as `POST /api/v1/workspaces/{slug}/documents` (multipart, part `files`). Uses
 * XMLHttpRequest because `fetch` can't report upload progress. One file per request: the API accepts
 * or refuses a request as a whole, and each file should succeed or fail on its own. `signal` aborts it.
 */
export function uploadFile(opts: {
  slug: string;
  file: File;
  token: string | null;
  signal: AbortSignal;
  onProgress(fraction: number): void;
}): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const aborted = () => resolve({ ok: false, status: 0, detail: 'Aborted' });
    if (opts.signal.aborted) return aborted();
    opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.open('POST', `/api/v1/workspaces/${encodeURIComponent(opts.slug)}/documents`);
    if (opts.token) xhr.setRequestHeader('authorization', `Bearer ${opts.token}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as (UploadResult & { detail?: string; title?: string }) | null;
      if (xhr.status === 201 && body?.data[0]) resolve({ ok: true, status: 201, result: body.data[0] });
      else
        resolve({ ok: false, status: xhr.status, detail: failureDetail(body, xhr.status, xhr.statusText) });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, detail: '' });
    xhr.onabort = aborted;
    const form = new FormData();
    form.append('files', opts.file, opts.file.name);
    xhr.send(form);
  });
}
