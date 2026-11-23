import { ExternalLink } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ErrorState, Loading } from '@/components/states';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { previewSrc } from '@/documents/preview';
import { useDocumentFile } from '@/documents/queries';

/** The document a preview shows, and the page to open it on (null for the first). */
export type PreviewTarget = { id: string; title: string; page: number | null };

/**
 * A PDF shown in the browser's own viewer, inside the app, opened on the cited page. The file is fetched
 * with the bearer token (a frame can't send one) and shown from an object URL.
 */
export function DocumentPreviewDialog({
  slug,
  target,
  onClose,
}: {
  slug: string;
  target: PreviewTarget | null;
  onClose(): void;
}) {
  const file = useDocumentFile(slug, target?.id ?? null);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[90vh] flex-col gap-4 sm:max-w-5xl">
        <div>
          <DialogTitle>{target?.title ?? 'Document'}</DialogTitle>
          <DialogDescription className="mt-1">
            {target?.page ? `Opened on page ${target.page}` : 'The original file'}
          </DialogDescription>
        </div>
        {file.isPending && <Loading what="the document" />}
        {file.isError && (
          <ErrorState
            title="Couldn't load the document"
            error={file.error}
            onRetry={() => void file.refetch()}
          />
        )}
        {file.data && target && <PdfFrame blob={file.data} page={target.page} title={target.title} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The frame, pointed at an object URL made here and revoked when it goes. The URL is set on the element
 * directly rather than through state, so StrictMode's second effect run gets a fresh, live URL.
 */
function PdfFrame({ blob, page, title }: { blob: Blob; page: number | null; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const link = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (frame.current) frame.current.src = previewSrc(url, page);
    if (link.current) link.current.href = previewSrc(url, page);
    return () => URL.revokeObjectURL(url);
  }, [blob, page]);

  return (
    <>
      <iframe
        ref={frame}
        data-testid="pdf-preview"
        title={`${title} (preview)`}
        className="min-h-0 w-full flex-1 rounded-md border"
      />
      <a
        ref={link}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground inline-flex items-center gap-1.5 self-end text-xs hover:underline"
      >
        <ExternalLink className="size-3.5" /> Open in a new tab
      </a>
    </>
  );
}
