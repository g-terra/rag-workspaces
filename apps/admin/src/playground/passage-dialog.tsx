import { BookOpen, ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { DocumentPreviewDialog, type PreviewTarget } from '@/components/document-preview-dialog';
import { ErrorState, Loading } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { passageWhere } from './answer';
import { usePassage } from './queries';

/**
 * The passage behind a citation or a search hit, with the passages just before and after it so the
 * sentence can be read in context, and a link to its document in the library. A PDF passage also opens
 * the PDF itself, on its page, without leaving the dialog's page.
 */
export function PassageDialog({
  slug,
  passageId,
  onClose,
}: {
  slug: string;
  passageId: string | null;
  onClose(): void;
}) {
  // Radix keeps the content mounted while the dialog fades out, by which time `passageId` is already
  // null. Reading the last one asked for keeps the passage on screen until it is gone, instead of
  // collapsing to "Loading the passage…" on the way out.
  const [shown, setShown] = useState<string | null>(passageId);
  if (passageId !== null && passageId !== shown) setShown(passageId);
  const passage = usePassage(slug, shown);
  const found = passage.data?.passage;
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  return (
    <Dialog open={passageId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] gap-5 overflow-y-auto sm:max-w-2xl">
        <div>
          <DialogTitle>{found ? found.documentTitle : 'Passage'}</DialogTitle>
          <DialogDescription className="mt-1">
            {found ? passageWhere(found) : 'The passage this citation points at.'}
          </DialogDescription>
        </div>
        {passage.isPending && <Loading what="the passage" />}
        {passage.isError && (
          <ErrorState
            title="Couldn't load the passage"
            error={passage.error}
            onRetry={() => void passage.refetch()}
          />
        )}
        {passage.data && (
          <>
            <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
              {passage.data.previous && (
                <p className="text-muted-foreground">…{passage.data.previous.text}</p>
              )}
              <p
                data-testid="passage-text"
                className="bg-accent/60 rounded-lg px-3.5 py-3 text-sm leading-relaxed"
              >
                {passage.data.passage.text}
              </p>
              {passage.data.next && <p className="text-muted-foreground">{passage.data.next.text}…</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground font-mono text-xs">{passage.data.passage.id}</p>
              <div className="flex flex-wrap gap-2">
                {/* Only PDF passages carry a page, so a page means there is a PDF to show. */}
                {passage.data.passage.page !== null && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPreview({
                        id: passage.data.passage.documentId,
                        title: passage.data.passage.documentTitle,
                        page: passage.data.passage.page,
                      })
                    }
                  >
                    <BookOpen /> View page {passage.data.passage.page}
                  </Button>
                )}
                {passage.data.passage.sourceUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={passage.data.passage.sourceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open the page
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link
                    to={`/w/${slug}/documents?doc=${encodeURIComponent(passage.data.passage.documentId)}`}
                  >
                    <FileText /> Open the document
                  </Link>
                </Button>
              </div>
            </div>
          </>
        )}
        {/* Inside the content, so Radix stacks it on this dialog: a click in the preview isn't a click
            outside the passage, which would close both. */}
        <DocumentPreviewDialog slug={slug} target={preview} onClose={() => setPreview(null)} />
      </DialogContent>
    </Dialog>
  );
}
