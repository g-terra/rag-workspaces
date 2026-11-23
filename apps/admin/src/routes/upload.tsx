import type { Document } from '@rag/shared';
import { Upload as UploadIcon } from 'lucide-react';
import { Fragment, useEffect, useReducer, useRef, useState, type DragEvent } from 'react';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { sendAuthorized } from '@/auth/authorized';
import { Notice } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { ACCEPT, checkFile, uploadErrorMessage } from '@/documents/files';
import { createLimiter } from '@/documents/queue';
import {
  initialSession,
  missingFromSnapshot,
  rowView,
  sessionReducer,
  sessionSummary,
} from '@/documents/session';
import { uploadFile } from '@/documents/upload';
import { useDocumentEvents } from '@/documents/use-document-events';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/workspaces/current';

const LIFECYCLE = [
  ['queued', 'Queued'],
  ['processing', 'Processing'],
  ['ready', 'Ready'],
] as const;

/** Files sent at once; the rest wait in the page's queue. */
const PARALLEL_UPLOADS = 3;

/** `/w/:slug/upload`: drop files, watch each one upload and go through ingestion live. */
export function Upload() {
  const w = useCurrentWorkspace();

  // A file dropped beside the drop zone would otherwise open in the tab and leave the page.
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  return (
    <>
      <TopBar trail={[w.name, 'Upload']} />
      <div className="flex w-full max-w-290 flex-col gap-6 px-6 pt-7 pb-12">
        <div>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">Upload material</h1>
          <p className="text-muted-foreground text-sm">
            Files are stored, checked for duplicates, then run through the Langflow ingest flow one at a time.
            Status updates live.
          </p>
        </div>
        {w.access === 'reader' ? (
          <Notice
            title="You can't upload here"
            body="Your access to this workspace is read-only. Ask an administrator for editor access."
          />
        ) : (
          // A fresh uploader per workspace, so rows don't carry over when switching.
          <Uploader key={w.slug} slug={w.slug} />
        )}
      </div>
    </>
  );
}

function Uploader({ slug }: { slug: string }) {
  const auth = useAuth();
  const { api } = auth;
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [dragging, setDragging] = useState(false);
  const nextKey = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const [queue] = useState(() => createLimiter(PARALLEL_UPLOADS));
  const abort = useRef(new AbortController());

  // Leaving the page cancels the uploads still running or waiting.
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);

  // Closing or reloading the tab mid-upload asks first.
  const busy = session.rows.some((r) => r.phase === 'waiting' || r.phase === 'uploading');
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  /** Fetches a document that finished or was deleted while the stream was down. */
  async function catchUp(id: string) {
    try {
      const document = await api<Document>(
        `/v1/workspaces/${encodeURIComponent(slug)}/documents/${encodeURIComponent(id)}`,
      );
      dispatch({ type: 'document', document });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404)
        dispatch({ type: 'event', event: { type: 'removed', id } });
      // Anything else: the next snapshot tries again.
    }
  }

  const stopped = useDocumentEvents(slug, (event) => {
    dispatch({ type: 'event', event });
    if (event.type === 'snapshot')
      for (const id of missingFromSnapshot(session, event.documents)) void catchUp(id);
  });

  function addFiles(list: FileList | null) {
    const files = [...(list ?? [])].map((file) => ({
      file,
      key: String(nextKey.current++),
      error: checkFile(file),
    }));
    if (!files.length) return;
    dispatch({
      type: 'added',
      files: files.map((f) => ({
        key: f.key,
        name: f.file.name,
        sizeBytes: f.file.size,
        error: f.error ?? undefined,
      })),
    });
    const { signal } = abort.current;
    for (const f of files) {
      if (f.error) continue;
      void queue(async () => {
        if (signal.aborted) return;
        dispatch({ type: 'started', key: f.key });
        // The token is fetched as the file's turn comes, so it can't expire while the file waits.
        const outcome = await sendAuthorized(auth, (token) =>
          uploadFile({
            slug,
            file: f.file,
            token,
            signal,
            onProgress: (fraction) => dispatch({ type: 'progress', key: f.key, fraction }),
          }),
        );
        if (signal.aborted) return;
        if (outcome.ok) dispatch({ type: 'uploaded', key: f.key, ...outcome.result });
        else
          dispatch({ type: 'failed', key: f.key, error: uploadErrorMessage(outcome.status, outcome.detail) });
      });
    }
  }

  async function retry(key: string, id: string) {
    dispatch({ type: 'retry', key });
    try {
      const document = await api<Document>(
        `/v1/workspaces/${encodeURIComponent(slug)}/documents/${encodeURIComponent(id)}/reindex`,
        { method: 'POST' },
      );
      dispatch({ type: 'retried', key, document });
    } catch (e) {
      dispatch({
        type: 'retryFailed',
        key,
        error: `Couldn't retry: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <>
      <div
        data-testid="drop-zone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'bg-muted/40 hover:bg-muted flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center',
          dragging && 'border-foreground/40 bg-muted',
        )}
      >
        <span className="bg-background inline-flex size-12 items-center justify-center rounded-xl border">
          <UploadIcon className="size-5" />
        </span>
        <p className="text-base font-semibold">Drop files here</p>
        <p className="text-muted-foreground text-sm">PDF, DOCX, TXT, MD · up to 200 MB each</p>
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          Browse files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Choose files to upload"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            addFiles(e.target.files);
            // Lets the same file be chosen again, to see it skipped as a duplicate.
            e.target.value = '';
          }}
        />
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span>Lifecycle:</span>
        {LIFECYCLE.map(([tone, label], i) => (
          <Fragment key={tone}>
            {i > 0 && <span aria-hidden>→</span>}
            <StatusBadge tone={tone} label={label} />
          </Fragment>
        ))}
        <span>or</span>
        <StatusBadge tone="failed" label="Failed" />
      </div>

      {stopped && (
        <p role="alert" className="text-destructive text-sm">
          Live updates stopped: {stopped}
        </p>
      )}

      <p className="sr-only" aria-live="polite">
        {session.rows.length > 0 && `This session: ${sessionSummary(session)}`}
      </p>

      {session.rows.length > 0 && (
        <section className="bg-card rounded-xl border" aria-label="This session">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">This session · {sessionSummary(session)}</h2>
          </div>
          <ul>
            {session.rows.map((row) => {
              const v = rowView(session, row);
              const ext = /\.([^.]+)$/.exec(row.name)?.[1]?.toUpperCase() ?? '?';
              return (
                <li
                  key={row.key}
                  data-testid="upload-row"
                  className="flex flex-wrap items-center gap-3.5 border-b px-5 py-3.5 last:border-b-0"
                >
                  <span className="bg-muted inline-flex size-9 flex-none items-center justify-center rounded-lg text-[10px] font-semibold">
                    {ext.slice(0, 4)}
                  </span>
                  <div className="min-w-0 flex-[1_1_260px]">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p
                      className={cn(
                        'mt-0.5 text-xs',
                        v.tone === 'failed' ? 'text-red-800' : 'text-muted-foreground',
                      )}
                    >
                      {v.meta}
                    </p>
                    {v.retryError && (
                      <p role="alert" className="text-destructive mt-0.5 text-xs">
                        {v.retryError}
                      </p>
                    )}
                    {v.progress !== null && (
                      <div
                        role="progressbar"
                        aria-label={`Uploading ${row.name}`}
                        aria-valuenow={v.progress}
                        className="bg-muted mt-2 h-1 max-w-90 rounded-sm"
                      >
                        <div className="bg-primary h-1 rounded-sm" style={{ width: `${v.progress}%` }} />
                      </div>
                    )}
                  </div>
                  <StatusBadge tone={v.tone} label={v.label} />
                  <div className="flex w-21 justify-end">
                    {v.canRetry && v.document && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Retry ${row.name}`}
                        disabled={v.retryPending}
                        onClick={() => void retry(row.key, v.document!.id)}
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
