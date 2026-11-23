import type { Site } from '@rag/shared';
import { ExternalLink, Globe, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/field';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatRelative } from '@/lib/dates';
import { useAddSite, useCrawlSite, useRemoveSite, useSites } from '@/sites/queries';
import {
  displayUrl,
  isCrawling,
  parseExcludePaths,
  siteProgress,
  siteStatusLabel,
  siteTone,
} from '@/sites/sites';

/**
 * The workspace's imported documentation websites, above the document library: each with its crawl's
 * progress, and for editors Crawl again and Remove. Hidden when there are none.
 */
export function Websites({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const sites = useSites(slug);
  if (!sites.data?.length) return null;
  return (
    <section aria-label="Websites" className="bg-card rounded-xl border">
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Websites</h2>
      <ul>
        {sites.data.map((s) => (
          <SiteRow key={s.id} slug={slug} site={s} canEdit={canEdit} />
        ))}
      </ul>
    </section>
  );
}

function SiteRow({ slug, site, canEdit }: { slug: string; site: Site; canEdit: boolean }) {
  const crawl = useCrawlSite(slug);
  const [removing, setRemoving] = useState(false);
  const busy = isCrawling(site);
  return (
    <li
      data-testid="site-row"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0"
    >
      <Globe className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-[1_1_260px]">
        <a
          href={site.startUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 text-sm font-medium hover:underline"
        >
          <span className="truncate">{displayUrl(site.startUrl)}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
        <p className="text-muted-foreground text-xs">
          {site.documentCount.toLocaleString('en')} pages · {siteProgress(site)}
          {site.crawledAt && !busy && <> · crawled {formatRelative(site.crawledAt)}</>}
        </p>
        {site.lastError && (
          <p
            className={
              site.status === 'failed' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
            }
          >
            {site.lastError}
          </p>
        )}
        {crawl.error && (
          <p role="alert" className="text-destructive text-xs">
            {crawl.error.message}
          </p>
        )}
      </div>
      <StatusBadge tone={siteTone(site)} label={siteStatusLabel(site)} />
      {canEdit && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || crawl.isPending}
            onClick={() => crawl.mutate(site.id)}
          >
            <RefreshCw /> Crawl again
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={site.status === 'crawling'}
            aria-label={`Remove ${displayUrl(site.startUrl)}`}
            onClick={() => setRemoving(true)}
          >
            <Trash2 />
          </Button>
          <RemoveSiteDialog slug={slug} site={site} open={removing} onOpenChange={setRemoving} />
        </div>
      )}
    </li>
  );
}

function RemoveSiteDialog(props: {
  slug: string;
  site: Site;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const remove = useRemoveSite(props.slug);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        remove.reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogTitle>Remove this website?</DialogTitle>
        <DialogDescription>
          {displayUrl(props.site.startUrl)} and its {props.site.documentCount.toLocaleString('en')} pages are
          removed from the workspace, with their passages. Add the website again to re-import it.
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
            onClick={() => remove.mutate(props.site.id, { onSuccess: () => props.onOpenChange(false) })}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Editors' "Add website" form: a start URL, a page limit and paths to leave out. */
export function AddWebsiteDialog({
  slug,
  open,
  onOpenChange,
}: {
  slug: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const add = useAddSite(slug);
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState('1000');
  const [exclude, setExclude] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      add.reset();
      setError(null);
    }
    onOpenChange(next);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const excluded = parseExcludePaths(exclude);
    if ('error' in excluded) return setError(excluded.error);
    const pages = Number(maxPages);
    if (!Number.isInteger(pages) || pages < 1 || pages > 10_000)
      return setError('Max pages is a whole number from 1 to 10,000.');
    setError(null);
    add.mutate(
      {
        url: url.trim(),
        maxPages: pages,
        ...(excluded.paths.length ? { excludePaths: excluded.paths } : {}),
      },
      {
        onSuccess: () => {
          setUrl('');
          setExclude('');
          close(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogTitle>Import a website</DialogTitle>
        <DialogDescription>
          Pages under the start URL are fetched politely (robots.txt and the sitemap are honoured, one page a
          second), and each becomes a document whose citations link back to the page.
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field id="site-url" label="Start URL" hint="Only pages under this path are imported.">
            <Input
              id="site-url"
              type="url"
              required
              placeholder="https://auth0.com/docs"
              aria-describedby="site-url-note"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field
            id="site-max"
            label="Max pages"
            hint="Start small to check the result; crawl again for more."
          >
            <Input
              id="site-max"
              inputMode="numeric"
              aria-describedby="site-max-note"
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
            />
          </Field>
          <Field
            id="site-exclude"
            label="Leave out (optional)"
            hint="Paths to skip, one per line, for example translations: /docs/fr-ca/"
          >
            <textarea
              id="site-exclude"
              rows={3}
              aria-describedby="site-exclude-note"
              className="border-input dark:bg-input/30 w-full rounded-md border bg-transparent px-2.5 py-2 font-mono text-xs shadow-xs"
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
            />
          </Field>
          {(error ?? add.error) && (
            <p role="alert" className="text-destructive text-sm">
              {error ?? add.error?.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={add.isPending || !url.trim()}>
              {add.isPending ? 'Adding…' : 'Import'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
