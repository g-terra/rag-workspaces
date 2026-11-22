import type { UploadResult } from '@rag/shared';

export type UploadOutcome =
  | { ok: true; result: UploadResult['data'][number] }
  /** `status` 0: no answer (network error). */
  | { ok: false; status: number; detail: string };

/**
 * Uploads one file as `POST /api/v1/workspaces/{slug}/documents` (multipart, part `files`). Uses
 * XMLHttpRequest because `fetch` can't report upload progress. One file per request: the API accepts
 * or refuses a request as a whole, and each file should succeed or fail on its own.
 */
export function uploadFile(opts: {
  slug: string;
  file: File;
  token: string | null;
  onProgress(fraction: number): void;
}): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/workspaces/${encodeURIComponent(opts.slug)}/documents`);
    if (opts.token) xhr.setRequestHeader('authorization', `Bearer ${opts.token}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as (UploadResult & { detail?: string; title?: string }) | null;
      if (xhr.status === 201 && body?.data[0]) resolve({ ok: true, result: body.data[0] });
      else resolve({ ok: false, status: xhr.status, detail: body?.detail ?? body?.title ?? xhr.statusText });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, detail: '' });
    const form = new FormData();
    form.append('files', opts.file, opts.file.name);
    xhr.send(form);
  });
}
