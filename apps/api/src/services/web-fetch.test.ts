import { LangflowClient } from '@rag/langflow-client';
import { describe, expect, it } from 'vitest';
import { LangflowPageFetcher } from './web-fetch.js';

/** A Langflow that records each run and answers with `reply` as the flow's fenced JSON output. */
function langflow(reply: object) {
  const runs: { url: string; body: { session_id: string; tweaks: Record<string, unknown> } }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    runs.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const text = '```json\n' + JSON.stringify(reply) + '\n```';
    return Response.json({
      outputs: [{ outputs: [{ component_id: 'ChatOutput-result', results: { message: { text } } }] }],
    });
  }) as typeof fetch;
  return { runs, client: new LangflowClient({ baseUrl: 'http://lf', apiKey: 'sk', fetch: fetchFn }) };
}

describe('LangflowPageFetcher', () => {
  it('runs rw-fetch in page mode with the options as Fetch tweaks', async () => {
    const page = { url: 'https://d.org/a', finalUrl: 'https://d.org/a', status: 200, markdown: '# A' };
    const { runs, client } = langflow(page);
    const got = await new LangflowPageFetcher(client).page('https://d.org/a', {
      preferMarkdown: true,
      wantLinks: false,
    });
    expect(got).toEqual(page);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.url).toMatch(/\/run\/rw-fetch/);
    expect(runs[0]!.body.tweaks).toEqual({
      Fetch: { url: 'https://d.org/a', mode: 'page', prefer_markdown: true, want_links: false },
    });
    expect(runs[0]!.body.session_id).toMatch(/^fetch-/);
  });

  it('runs rw-fetch in sitemap mode for the scope', async () => {
    const map = { urls: ['https://d.org/a'], crawlDelay: null, hasLlmsTxt: true, complete: true };
    const { runs, client } = langflow(map);
    expect(await new LangflowPageFetcher(client).sitemap('https://d.org/')).toEqual(map);
    expect(runs[0]!.body.tweaks).toEqual({ Fetch: { url: 'https://d.org/', mode: 'sitemap' } });
  });
});
