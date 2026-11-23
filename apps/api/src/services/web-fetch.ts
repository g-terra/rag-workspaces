import { messageText, outputsByComponent, parseJsonMessage, type LangflowClient } from '@rag/langflow-client';
import { randomUUID } from 'node:crypto';
import { FLOWS } from '../flows.js';

/** One page as the `rw-fetch` flow returns it (flows/README.md). */
export type FetchedPage = {
  url: string;
  /** Where redirects ended. */
  finalUrl: string;
  /** HTTP status; 0 when nothing was fetched (blocked by robots.txt or by the SSRF guard, or an error). */
  status: number;
  title: string;
  markdown: string;
  links: string[];
  canonical: string | null;
  /** robots.txt disallows the page. */
  blocked: boolean;
  /** Set to the content type when the URL is not a page (an image, a PDF). */
  skipped: string | null;
  /** Network failure or refusal, in words. */
  error: string | null;
};

export type SiteMap = {
  urls: string[];
  /** robots.txt's Crawl-delay in seconds. */
  crawlDelay: number | null;
  /** The site publishes llms.txt, so pages likely have a Markdown twin at `<url>.md`. */
  hasLlmsTxt: boolean;
  /** Every sitemap was read and listed pages, so `urls` is the whole site and links need not be followed. */
  complete: boolean;
};

/** How the crawler reaches the web: only ever through Langflow (decision 18). */
export interface PageFetcher {
  page(
    url: string,
    opts: { preferMarkdown: boolean; wantLinks: boolean },
    signal?: AbortSignal,
  ): Promise<FetchedPage>;
  sitemap(scope: string, signal?: AbortSignal): Promise<SiteMap>;
}

/** Runs the `rw-fetch` flow, one URL per run. */
export class LangflowPageFetcher implements PageFetcher {
  constructor(private readonly langflow: LangflowClient) {}

  async page(url: string, opts: { preferMarkdown: boolean; wantLinks: boolean }, signal?: AbortSignal) {
    return this.run<FetchedPage>(
      { url, mode: 'page', prefer_markdown: opts.preferMarkdown, want_links: opts.wantLinks },
      signal,
    );
  }

  async sitemap(scope: string, signal?: AbortSignal) {
    return this.run<SiteMap>({ url: scope, mode: 'sitemap' }, signal);
  }

  private async run<T>(fetch: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const run = await this.langflow.run(
      FLOWS.fetch,
      { session_id: `fetch-${randomUUID()}`, tweaks: { Fetch: fetch } },
      signal,
    );
    return parseJsonMessage<T>(messageText(outputsByComponent(run)['ChatOutput-result']));
  }
}
