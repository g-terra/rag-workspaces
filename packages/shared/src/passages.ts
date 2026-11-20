import { z } from 'zod';

/**
 * A passage is one chunk of a document. Its id is `psg_<document ulid>_<chunk index>`, so it
 * stays the same when the document is re-indexed with the same chunk settings.
 */
export const Passage = z.object({
  id: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  /** Folders arrive in a later milestone; always `null` for now. */
  folderId: z.string().nullable(),
  /** 1-based page for PDFs, otherwise `null`. */
  page: z.number().int().nullable(),
  /** Position in a recording; `null` until audio and video are supported. */
  startSeconds: z.number().nullable(),
  chunkIndex: z.number().int(),
  text: z.string(),
});
export type Passage = z.infer<typeof Passage>;

/** A search hit: a passage plus its cosine similarity to the query (0 to 1, higher is closer). */
export const ScoredPassage = Passage.extend({ score: z.number() });
export type ScoredPassage = z.infer<typeof ScoredPassage>;

export const PassageSearch = z.object({
  query: z.string().trim().min(1).max(2000),
  /** Defaults to the workspace's `topK`, then `DEFAULT_TOP_K`. */
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** Defaults to the workspace's `minScore`, then `DEFAULT_MIN_SCORE`. */
  minScore: z.coerce.number().min(0).max(1).optional(),
});
export type PassageSearch = z.infer<typeof PassageSearch>;

/** Best first. Empty when nothing reaches `minScore`. */
export const PassageSearchResult = z.object({ data: z.array(ScoredPassage) });
export type PassageSearchResult = z.infer<typeof PassageSearchResult>;

/** One passage and the ones just before and after it in the same document. */
export const PassageWithNeighbours = z.object({
  passage: Passage,
  previous: Passage.nullable(),
  next: Passage.nullable(),
});
export type PassageWithNeighbours = z.infer<typeof PassageWithNeighbours>;

export const DocumentPassagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().regex(/^\d+$/, 'a cursor from a previous page').optional(),
});
export type DocumentPassagesQuery = z.infer<typeof DocumentPassagesQuery>;
