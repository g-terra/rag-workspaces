import type { Database, Workspace } from '@rag/db';
import type { LangflowClient } from '@rag/langflow-client';
import type { ScoredPassage } from '@rag/shared';
import type { Config } from '../config.js';
import { sourcesOf } from './composites.js';
import { resolveHits, retrieve } from './passages.js';
import { assertSearchable } from './reindex.js';
import { withWorkspaceKeys } from './provider-keys.js';

/** A passage found in one of a composite's sources. `rank` is its place in that source's own list, then in the fused one. */
export type SourceHit = ScoredPassage & { rank: number; workspaceName: string };

/** Reciprocal rank fusion constant, the same as hybrid search uses (flows/README.md). */
const RRF_K = 60;

/**
 * Merge each source's ranked list into one, best first, and number it 1..n.
 *
 * Sources may embed with different models, whose cosine scores are not on one scale, so the lists
 * are fused by rank (RRF). With sources that share no passages this takes turns, best first; a tie
 * goes to the higher score.
 */
export function fuseSources(lists: SourceHit[][], limit: number): SourceHit[] {
  return lists
    .flat()
    .map((hit) => ({ hit, fused: 1 / (RRF_K + hit.rank) }))
    .sort((a, b) => b.fused - a.fused || b.hit.score - a.hit.score)
    .slice(0, limit)
    .map(({ hit }, i) => ({ ...hit, rank: i + 1 }));
}

/** 12:34, or 1:02:03 past an hour, as the search component writes it. */
function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/**
 * The passages as the prompt's `{context}`, in the layout of the Search component's context output
 * (`langflow/components/rag_workspaces/chroma_search.py`), with the source workspace's name first and
 * the document's title in place of its file name.
 */
export function contextText(passages: SourceHit[]): string {
  if (!passages.length) return 'No relevant passages found.';
  return passages
    .map((p) => {
      let where = `${p.workspaceName}: ${p.documentTitle}`;
      if (p.page) where += `, page ${p.page}`;
      else if (p.startSeconds !== null) where += `, at ${clock(p.startSeconds)}`;
      return `[${p.rank}] (${where})\n${p.text}`;
    })
    .join('\n\n');
}

export type CompositeSearchConfig = Pick<
  Config,
  | 'DEFAULT_TOP_K'
  | 'DEFAULT_MIN_SCORE'
  | 'RETRIEVE_TIMEOUT_MS'
  | 'LMSTUDIO_BASE_URL'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'SECRETS_KEY'
>;

/**
 * Search every source of a composite and fuse the results. Each source is searched through
 * `rw-retrieve` with its own embedding model, prefixes, provider keys and `minScore`, for up to
 * `limit` passages (the composite's `topK` unless the caller asks for fewer). A source being
 * reindexed is skipped (503 when all are), and so is one whose search fails, unless all fail.
 */
export async function searchSources(
  deps: { db: Database; langflow: LangflowClient; config: CompositeSearchConfig },
  composite: Workspace,
  query: string,
  opts: { limit?: number } = {},
): Promise<SourceHit[]> {
  const { db, langflow, config } = deps;
  const limit = opts.limit ?? composite.settings.topK ?? config.DEFAULT_TOP_K;
  const all = await sourcesOf(db, composite);
  const sources = all.filter((s) => s.status === 'active');
  // Every source rebuilding: the same 503 a reindexing workspace gives, not a false "nothing found".
  if (all.length && !sources.length) assertSearchable(all[0]!);
  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const keys = await withWorkspaceKeys(db, config, source.id);
      const hits = await resolveHits(db, source, await retrieve(langflow, source, query, keys, { limit }));
      return hits.map((h) => ({ ...h, workspaceName: source.name }));
    }),
  );
  // One source down (its provider, its key) leaves the others to answer; all of them down is a failure.
  const lists = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!lists.length && settled.length) throw (settled[0] as PromiseRejectedResult).reason;
  return fuseSources(lists, limit);
}
