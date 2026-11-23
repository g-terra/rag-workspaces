import { describe, expect, it } from 'vitest';
import { ModelCatalog } from './models.js';

const signal = new AbortController().signal;

function catalog(
  keys: { OPENAI_API_KEY?: string; GEMINI_API_KEY?: string; ANTHROPIC_API_KEY?: string },
  answer: (url: string) => Response | Promise<Response>,
) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return answer(String(input));
  }) as typeof fetch;
  const models = new ModelCatalog({ LMSTUDIO_BASE_URL: 'http://lm:1234/v1/', ...keys }, fetchFn);
  return { models, requests };
}
const list = (...ids: string[]) => Response.json({ object: 'list', data: ids.map((id) => ({ id })) });

describe('ModelCatalog', () => {
  it('lists LM Studio models, sorted, and skips hosted providers without a key', async () => {
    const { models, requests } = catalog({}, () => list('qwen', 'nomic-embed'));
    const status = await models.status(signal);
    expect(status).toEqual([
      {
        id: 'lmstudio',
        configured: true,
        reachable: true,
        error: null,
        models: ['nomic-embed', 'qwen'],
        embeddings: true,
      },
      {
        id: 'openai',
        configured: false,
        reachable: null,
        error: 'OPENAI_API_KEY is not set',
        models: [],
        embeddings: true,
      },
      {
        id: 'gemini',
        configured: false,
        reachable: null,
        error: 'GEMINI_API_KEY is not set',
        models: [],
        embeddings: true,
      },
      {
        id: 'anthropic',
        configured: false,
        reachable: null,
        error: 'ANTHROPIC_API_KEY is not set',
        models: [],
        embeddings: false,
      },
    ]);
    expect(requests.map((r) => r.url)).toEqual(['http://lm:1234/v1/models']);
  });

  it('asks each hosted provider with its own key and header', async () => {
    const { models, requests } = catalog(
      { OPENAI_API_KEY: 'sk-o', GEMINI_API_KEY: 'g-key', ANTHROPIC_API_KEY: 'sk-a' },
      (url) => (url.includes('googleapis') ? list('models/gemini-2.5-flash') : list('m-1')),
    );
    const status = await models.status(signal);
    expect(status.find((p) => p.id === 'gemini')!.models).toEqual(['gemini-2.5-flash']);
    const headersFor = (host: string) => requests.find((r) => r.url.includes(host))!.headers;
    expect(headersFor('api.openai.com')).toEqual({ authorization: 'Bearer sk-o' });
    expect(headersFor('googleapis')).toEqual({ authorization: 'Bearer g-key' });
    expect(headersFor('api.anthropic.com')).toEqual({
      'x-api-key': 'sk-a',
      'anthropic-version': '2023-06-01',
    });
  });

  it('says in words when LM Studio is not running or a key is refused', async () => {
    const { models } = catalog({ OPENAI_API_KEY: 'bad' }, (url) => {
      if (url.startsWith('http://lm')) throw new TypeError('fetch failed');
      return new Response('{}', { status: 401 });
    });
    const [lm, openai] = await models.status(signal);
    expect(lm).toMatchObject({ reachable: false, models: [] });
    expect(lm!.error).toBe(
      'could not reach LM Studio at http://lm:1234/v1/ (fetch failed). Is it running, with its server started?',
    );
    expect(openai).toMatchObject({
      configured: true,
      reachable: false,
      error: 'OpenAI refused the key (HTTP 401)',
    });
  });

  it('tells a refused key (Gemini answers 400) from a provider that is down or busy', async () => {
    const { models } = catalog({ GEMINI_API_KEY: 'bad', OPENAI_API_KEY: 'good' }, (url) =>
      url.includes('generativelanguage')
        ? new Response('{}', { status: 400 })
        : new Response('{}', { status: url.includes('openai') ? 503 : 200 }),
    );
    expect(await models.check('gemini', signal)).toMatchObject({
      refused: true,
      status: { reachable: false, error: 'Gemini refused the key (HTTP 400)' },
    });
    expect(await models.check('openai', signal)).toMatchObject({
      refused: false,
      status: { reachable: false, error: 'OpenAI answered (HTTP 503)' },
    });
  });
});
