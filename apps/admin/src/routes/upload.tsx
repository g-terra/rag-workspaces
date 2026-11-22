import type { Document } from '@rag/shared';
import { Upload as UploadIcon } from 'lucide-react';
import { Fragment, useReducer, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { Notice } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { ACCEPT, checkFile, uploadErrorMessage } from '@/documents/files';
import { initialSession, rowView, sessionReducer, sessionSummary } from '@/documents/session';
import { uploadFile } from '@/documents/upload';
import { useDocumentEvents } from '@/documents/use-document-events';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/workspaces/current';

const LIFECYCLE = [
  ['queued', 'Queued'],
  ['processing', 'Processing'],
  ['ready', 'Ready'],
] as const;

/** `/w/:slug/upload`: drop files, watch each one upload and go through ingestion live. */
export function Upload() {
  const w = useCurrentWorkspace();
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
          <Uploader slug={w.slug} />
        )}
      </div>
    </>
  );
}

function Uploader({ slug }: { slug: string }) {
  const { api, getToken } = useAuth();
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [dragging, setDragging] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const nextKey = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useDocumentEvents(slug, (event) => dispatch({ type: 'event', event }));

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
    for (const f of files) {
      if (f.error) continue;
      void (async () => {
        const outcome = await uploadFile({
          slug,
          file: f.file,
          token: await getToken(),
          onProgress: (fraction) => dispatch({ type: 'progress', key: f.key, fraction }),
        });
        if (outcome.ok) dispatch({ type: 'uploaded', key: f.key, ...outcome.result });
        else
          dispatch({ type: 'failed', key: f.key, error: uploadErrorMessage(outcome.status, outcome.detail) });
      })();
    }
  }

  async function retry(id: string) {
    setRetryError(null);
    try {
      const document = await api<Document>(
        `/v1/workspaces/${encodeURIComponent(slug)}/documents/${encodeURIComponent(id)}/reindex`,
        { method: 'POST' },
      );
      dispatch({ type: 'document', document });
    } catch (e) {
      setRetryError(`Couldn't retry: ${e instanceof Error ? e.message : String(e)}`);
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

      {session.rows.length > 0 && (
        <section className="bg-card rounded-xl border" aria-label="This session">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">This session · {sessionSummary(session)}</h2>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/w/${slug}/documents`}>View in library</Link>
            </Button>
          </div>
          {retryError && (
            <p role="alert" className="text-destructive border-b px-5 py-2 text-sm">
              {retryError}
            </p>
          )}
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
                      <Button variant="outline" size="sm" onClick={() => void retry(v.document!.id)}>
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
