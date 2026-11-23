// Stand-in for LM Studio's OpenAI-compatible server, for running the POC where
// LM Studio is not available (CI, cloud sandboxes). Zero dependencies: run with
// `node standin/server.ts` (Node 22.18+ strips TypeScript types natively).
//
// - POST /v1/embeddings: deterministic 384-dim hashed bag-of-words vectors, so
//   lexical overlap gives real similarity and retrieval results are meaningful.
// - POST /v1/chat/completions: builds an "answer" from the prompt, and streams it
//   word by word (SSE) when stream=true, with a delay so streaming is observable.
// - POST /v1/messages: the same, in Anthropic's Messages API shape (incl. streaming).
// - POST /asr: stands in for the Whisper ASR service; any file gets the same two timed segments.
// - GET /site/docs/...: a tiny documentation website (robots.txt, sitemap, three pages and one robots.txt
//   disallows) for the website import's smoke check.
// - GET /_log: every request seen (path, model, stream flag), so the POC can
//   prove which model name a Langflow tweak actually sent.
//
// It is NOT a language model. It only proves the plumbing. Rerun the POC against
// LM Studio for real answers (see poc/README.md).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.STANDIN_PORT ?? 1234);
const DIM = 384;
const TOKEN_DELAY_MS = Number(process.env.STANDIN_TOKEN_DELAY_MS ?? 40);

type LogEntry = { at: string; path: string; model?: string; stream?: boolean; inputs?: number; prompt?: string; error?: string };
const log: LogEntry[] = [];

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) ?? [];
}

function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const tok of tokenize(text)) {
    if (tok.length < 2) continue;
    const h = createHash('sha1').update(tok).digest();
    const idx = h.readUInt32BE(0) % DIM;
    const sign = h[4] & 1 ? 1 : -1;
    v[idx] += sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n');
  return '';
}

// Compose a deterministic answer: name the model, then quote the first context
// sentence that shares the most words with the question. The bold lead-in is there so
// the admin UI's e2e test can see the answer rendered as markdown.
function composeAnswer(model: string, messages: { role: string; content: unknown }[]): string {
  const all = messages.map((m) => messageText(m.content)).join('\n');
  const question = /question:\s*(.+)/i.exec(all)?.[1] ?? messageText(messages.at(-1)?.content);
  const qTokens = new Set(tokenize(question).filter((t) => t.length > 3));
  const sentences = all.replace(/([^.!?\n])\n(?!\n)/g, '$1 ').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 20);
  let best = '';
  let bestScore = -1;
  for (const s of sentences) {
    if (/question:/i.test(s)) continue;
    const score = tokenize(s).filter((t) => qTokens.has(t)).length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  // Cite the first numbered passage, as the system prompt asks; the API counts an uncited reply as ungrounded.
  const cite = /^\[(\d+)\] \(/m.exec(all)?.[1];
  return `[stand-in ${model}] **Based on the provided context:** ${best || 'no context was given.'}${best && cite ? ` [${cite}]` : ''}`;
}

// The stub docs site. Each page has navigation and a footer around its text, so the check can see that
// only the main content is kept.
const ORIGIN = 'http://standin:1234';
const DOCS_PAGES: Record<string, [string, string]> = {
  '/site/docs/': ['Stub Docs', 'Welcome to the stub docs. Start with installation, then read about usage.'],
  '/site/docs/install': ['Install', 'Install the gizmo with the flux capacitor package manager before first use.'],
  '/site/docs/usage': ['Usage', 'Turn the gizmo clockwise three times to calibrate the widget sprocket.'],
  '/site/docs/private': ['Private', 'This page is disallowed by robots.txt and must never be imported.'],
};
function docsSite(path: string, res: ServerResponse): boolean {
  if (path === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`User-agent: *\nDisallow: /site/docs/private\nSitemap: ${ORIGIN}/site/docs/sitemap.xml\n`);
    return true;
  }
  if (path === '/site/docs/sitemap.xml') {
    const urls = ['/site/docs/', '/site/docs/install', '/site/docs/usage'];
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        urls.map((u) => `<url><loc>${ORIGIN}${u}</loc></url>`).join('') +
        '</urlset>',
    );
    return true;
  }
  const page = DOCS_PAGES[path];
  if (!page) return false;
  const nav = Object.keys(DOCS_PAGES).map((p) => `<a href="${p}">${DOCS_PAGES[p]![0]} link</a>`).join(' ');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><head><title>${page[0]} - Stub Docs</title></head><body>` +
      `<nav>Sidebar navigation ${nav}</nav><main><h1>${page[0]}</h1><p>${page[1]}</p></main>` +
      `<footer>Footer copyright stub</footer></body></html>`,
  );
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && url.pathname === '/_log') return send(res, 200, log);
    if (req.method === 'GET' && docsSite(url.pathname, res)) return;
    if (req.method === 'DELETE' && url.pathname === '/_log') { log.length = 0; return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/asr') {
      let bytes = 0;
      for await (const c of req) bytes += (c as Buffer).length;
      log.push({ at: new Date().toISOString(), path: url.pathname, inputs: bytes });
      return send(res, 200, {
        language: 'en',
        text: 'Welcome to the lecture on vector databases. Chroma stores embeddings with metadata.',
        segments: [
          { id: 0, start: 0, end: 3.2, text: ' Welcome to the lecture on vector databases.' },
          { id: 1, start: 3.2, end: 7.5, text: ' Chroma stores embeddings with metadata.' },
        ],
      });
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return send(res, 200, { object: 'list', data: [
        { id: 'standin-embed-a', object: 'model' }, { id: 'standin-embed-b', object: 'model' },
        { id: 'standin-chat-a', object: 'model' }, { id: 'standin-chat-b', object: 'model' },
      ] });
    }

    if (req.method === 'POST' && url.pathname === '/v1/embeddings') {
      const body = await readJson(req);
      const inputs: unknown[] = Array.isArray(body.input) ? body.input : [body.input];
      // LangChain's OpenAIEmbeddings sends token-id arrays when tiktoken is on.
      // LM Studio rejects those, so the stand-in does too.
      if (inputs.some((i) => typeof i !== 'string')) {
        const error = 'Token-array input is not supported. Set tiktoken_enable=false on the embeddings component.';
        log.push({ at: new Date().toISOString(), path: url.pathname, model: body.model, error });
        return send(res, 400, { error: { message: error } });
      }
      log.push({ at: new Date().toISOString(), path: url.pathname, model: body.model, inputs: inputs.length,
        starts: (inputs as string[]).map((t) => t.slice(0, 40)) });
      return send(res, 200, {
        object: 'list', model: body.model,
        data: inputs.map((t, index) => ({ object: 'embedding', index, embedding: embed(t as string) })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readJson(req);
      const model: string = body.model;
      const stream = Boolean(body.stream);
      const prompt = (body.messages ?? []).map((m: any) => messageText(m.content)).join('\n').slice(0, 200);
      log.push({ at: new Date().toISOString(), path: url.pathname, model, stream, prompt, reasoning_effort: body.reasoning_effort });
      const answer = composeAnswer(model, body.messages ?? []);
      const id = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      if (!stream) {
        return send(res, 200, {
          id, object: 'chat.completion', created, model,
          choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const chunk = (delta: object, finish: string | null = null) =>
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: 'assistant', content: '' });
      for (const piece of answer.split(/(?<=\s)/)) {
        chunk({ content: piece });
        await new Promise((r) => setTimeout(r, TOKEN_DELAY_MS));
      }
      chunk({}, 'stop');
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Minimal Anthropic Messages API, so the provider switch can be tested end to end.
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      const body = await readJson(req);
      const model: string = body.model;
      const stream = Boolean(body.stream);
      const msgs = [...(body.system ? [{ role: 'system', content: body.system }] : []), ...(body.messages ?? [])];
      const prompt = msgs.map((m: any) => messageText(m.content)).join('\n').slice(0, 200);
      log.push({ at: new Date().toISOString(), path: url.pathname, model, stream, prompt });
      const answer = composeAnswer(model, msgs);
      const id = `msg_${Date.now()}`;
      const usage = { input_tokens: 1, output_tokens: 1 };
      if (!stream) {
        return send(res, 200, { id, type: 'message', role: 'assistant', model, stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: answer }], usage });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (const piece of answer.split(/(?<=\s)/)) {
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
        await new Promise((r) => setTimeout(r, TOKEN_DELAY_MS));
      }
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      ev('message_stop', {});
      return res.end();
    }

    send(res, 404, { error: { message: `no route ${req.method} ${url.pathname}` } });
  } catch (err) {
    send(res, 500, { error: { message: String(err) } });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`stand-in OpenAI-compatible server on :${PORT}`));
