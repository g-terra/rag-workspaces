import type { Document } from '@rag/shared';
import { Search, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DocumentPreviewDialog, type PreviewTarget } from '@/components/document-preview-dialog';
import { ErrorState, Loading, Notice } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatBytes, statusLabel } from '@/documents/files';
import { canPreview } from '@/documents/preview';
import {
  filterDocuments,
  isIngesting,
  librarySummary,
  shortSha,
  TABS,
  type StatusTab,
} from '@/documents/library';
import {
  useDeleteDocument,
  useDownloadDocument,
  useLiveDocuments,
  useReindexDocument,
} from '@/documents/queries';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/workspaces/current';

/** `/w/:slug/documents`: every document in the workspace, live, with preview (PDFs), download, reindex and delete. */
export function Documents() {
  const w = useCurrentWorkspace();
  // A fresh page per workspace, so the selection, filters and search don't carry over.
  return <Library key={w.slug} />;
}

function Library() {
  const w = useCurrentWorkspace();
  const canEdit = w.access !== 'reader';
  const documents = useLiveDocuments(w.slug);
  const [tab, setTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  // The selected document lives in the URL (`?doc=<id>`), so a citation in the playground can link
  // straight to one and a reloaded or shared link still shows the same document.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('doc');
  const setSelectedId = (id: string) => setParams({ doc: id }, { replace: true });
  const list = documents.data ?? [];
  const shown = filterDocuments(list, tab, search);
  const selected = list.find((d) => d.id === selectedId) ?? null;
  const table = useRef<HTMLTableElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // After a delete the panel's buttons are gone; keep focus in the list (or on the heading once empty).
  const focusList = () => (table.current ?? heading.current)?.focus();

  return (
    <>
      <TopBar trail={[w.name, 'Documents']}>
        {canEdit && (
          <Button size="sm" asChild>
            <Link to={`/w/${w.slug}/upload`}>
              <Upload /> Upload
            </Link>
          </Button>
        )}
      </TopBar>
      <div className="flex w-full max-w-290 flex-col gap-6 px-6 pt-7 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              ref={heading}
              tabIndex={-1}
              className="mb-1.5 text-2xl font-semibold tracking-tight outline-none"
            >
              Document library
            </h1>
            <p className="text-muted-foreground text-sm">{documents.data && librarySummary(list)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-60">
              <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
              <Input
                className="pl-9"
                placeholder="Search titles"
                aria-label="Search documents"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div role="group" aria-label="Status" className="bg-muted flex rounded-lg p-0.5">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'h-8 rounded-md px-3 text-sm',
                    tab === key ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {documents.isPending && <Loading what="documents" />}
        {documents.isError && (
          <ErrorState
            title="Couldn't load documents"
            error={documents.error}
            onRetry={() => void documents.refetch()}
          />
        )}
        {documents.data?.length === 0 &&
          (canEdit ? (
            <Notice title="No documents yet" body="Upload PDF, DOCX, TXT or MD files to fill this workspace.">
              <Button asChild>
                <Link to={`/w/${w.slug}/upload`}>
                  <Upload /> Upload files
                </Link>
              </Button>
            </Notice>
          ) : (
            <Notice title="No documents yet" body="Nothing has been uploaded to this workspace yet." />
          ))}
        {list.length > 0 && (
          <div className="flex flex-wrap items-start gap-4">
            <div className="bg-card min-w-0 flex-[999_1_520px] overflow-x-auto rounded-xl border">
              <table ref={table} tabIndex={-1} aria-label="Documents" className="w-full text-sm outline-none">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    {['Title', 'Type', 'Passages', 'Status', 'Updated'].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr
                      key={d.id}
                      data-testid="document-row"
                      onClick={() => setSelectedId(d.id)}
                      className={cn(
                        'hover:bg-muted/50 cursor-pointer border-b last:border-b-0',
                        d.id === selectedId && 'bg-muted',
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          aria-current={d.id === selectedId ? 'true' : undefined}
                          className="text-left font-medium"
                        >
                          {d.title}
                        </button>
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 font-mono text-xs">{d.type}</td>
                      <td className="text-muted-foreground px-4 py-2.5">{d.passageCount ?? '–'}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge tone={d.status} label={statusLabel(d.status)} />
                      </td>
                      <td
                        className="text-muted-foreground px-4 py-2.5 whitespace-nowrap"
                        title={new Date(d.updatedAt).toLocaleString('en-GB', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      >
                        {formatRelative(d.updatedAt)}
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-muted-foreground px-4 py-6 text-center">
                        No documents match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <aside
              aria-label="Selected document"
              className="bg-card flex max-w-85 flex-[1_1_280px] flex-col gap-3.5 rounded-xl border p-4.5"
            >
              {selected ? (
                <DocumentDetail
                  key={selected.id}
                  slug={w.slug}
                  doc={selected}
                  canEdit={canEdit}
                  onDeleted={focusList}
                />
              ) : (
                <p className="text-muted-foreground text-sm">Select a document to see its details.</p>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

function DocumentDetail({
  slug,
  doc,
  canEdit,
  onDeleted,
}: {
  slug: string;
  doc: Document;
  canEdit: boolean;
  onDeleted(): void;
}) {
  const ingesting = isIngesting(doc);
  const reindex = useReindexDocument(slug);
  const download = useDownloadDocument(slug);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const error = reindex.error ?? download.error;
  const facts: [string, string][] = [
    ['Id', doc.id],
    ['File', doc.fileName],
    ['Size', formatBytes(doc.sizeBytes)],
    ['Passages', doc.passageCount?.toLocaleString('en') ?? '–'],
    ['Attempts', String(doc.attempts)],
    ['sha256', shortSha(doc.sha256)],
  ];

  return (
    <>
      <div>
        <p className="text-muted-foreground mb-1 text-xs">Selected document</p>
        <h2 className="text-base leading-snug font-semibold">{doc.title}</h2>
      </div>
      <StatusBadge tone={doc.status} label={statusLabel(doc.status)} className="self-start" />
      {doc.status === 'failed' && doc.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2.5 text-[13px] leading-normal text-red-800">
          {doc.error}
        </p>
      )}
      <dl className="text-[13px]">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b py-1.5 last:border-b-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn('truncate', (label === 'Id' || label === 'sha256') && 'font-mono text-xs')}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {error && (
        <p role="alert" className="text-destructive text-[13px]">
          {error.message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            disabled={reindex.isPending || ingesting}
            onClick={() => {
              download.reset();
              reindex.mutate(doc.id);
            }}
          >
            {doc.status === 'failed' ? 'Retry' : 'Reindex'}
          </Button>
        )}
        {canPreview(doc.type) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreview({ id: doc.id, title: doc.title, page: null })}
          >
            Preview
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={download.isPending}
          onClick={() => {
            reindex.reset();
            download.mutate(doc);
          }}
        >
          Download
        </Button>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={ingesting}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )}
      </div>
      {canEdit && (
        <p className="text-muted-foreground text-xs leading-normal">
          {ingesting
            ? 'Reindex and Delete are available once ingestion finishes.'
            : "Reindex deletes this document's vectors and runs the ingest flow again. Delete removes the file and its vectors."}
        </p>
      )}
      {canEdit && (
        <DeleteDialog
          slug={slug}
          doc={doc}
          open={confirming}
          onOpenChange={setConfirming}
          onDeleted={onDeleted}
        />
      )}
      <DocumentPreviewDialog slug={slug} target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function DeleteDialog(props: {
  slug: string;
  doc: Document;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDeleted(): void;
}) {
  const remove = useDeleteDocument(props.slug);
  const deleted = useRef(false);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        remove.reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent
        onCloseAutoFocus={(e) => {
          // The Delete button that opened the dialog is gone with the document.
          if (!deleted.current) return;
          e.preventDefault();
          props.onDeleted();
        }}
      >
        <DialogTitle>Delete this document?</DialogTitle>
        <DialogDescription>
          "{props.doc.title}" and its passages are removed from the workspace. This can't be undone.
        </DialogDescription>
        {remove.error && (
          <p role="alert" className="text-destructive text-sm">
            {remove.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              // Set before the answer: on success the panel, and this dialog with it, can unmount at once.
              deleted.current = true;
              remove.mutate(props.doc.id, {
                onSuccess: () => props.onOpenChange(false),
                onError: () => (deleted.current = false),
              });
            }}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
