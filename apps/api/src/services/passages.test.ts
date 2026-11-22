import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { normalise, parsePassageId, passageId, searchTweaks } from './passages.js';

const DOC = 'doc_01JC0000000000000000000000';

describe('passage ids', () => {
  it('round-trips a document id and chunk index', () => {
    const id = passageId(DOC, 12);
    expect(id).toBe('psg_01JC0000000000000000000000_12');
    expect(parsePassageId(id)).toEqual({ documentId: DOC, chunkIndex: 12 });
  });

  it('rejects anything else', () => {
    for (const bad of [
      'psg_x_1',
      'doc_01JC0000000000000000000000:1',
      'psg_01JC0000000000000000000000_',
      '',
    ]) {
      expect(parsePassageId(bad)).toBeNull();
    }
  });
});

describe('searchTweaks', () => {
  const config = loadConfig({ NODE_ENV: 'test', DEFAULT_TOP_K: '5', DEFAULT_MIN_SCORE: '0.3' });
  const workspace = {
    slug: 'ouc',
    settings: { embeddingProvider: 'lmstudio', embeddingModel: 'nomic', topK: 8, minScore: null },
  } as Parameters<typeof searchTweaks>[0];

  it('uses the workspace settings, then the global defaults', () => {
    expect(searchTweaks(workspace, config).Search).toEqual({
      collection_name: 'ws_ouc',
      top_k: 8,
      min_score: 0.3,
      folder: '',
    });
    expect(searchTweaks(workspace, config).Embeddings).toMatchObject({ model: 'nomic' });
  });

  it('lets the request override both', () => {
    expect(searchTweaks(workspace, config, { limit: 2, minScore: 0.7 }).Search).toMatchObject({
      top_k: 2,
      min_score: 0.7,
    });
  });
});

describe('normalise', () => {
  const hit = { rank: 1, id: `${DOC}:0`, text: 'x', score: 0.9 };
  it('accepts the search component object and a bare list', () => {
    expect(normalise({ collection: 'ws_ouc', passages: [hit] })).toHaveLength(1);
    expect(normalise([hit])).toHaveLength(1);
  });
  it('drops anything that is not a passage', () => {
    expect(normalise({ passages: [{ nope: 1 }, hit] })).toEqual([hit]);
    expect(normalise('No relevant passages found.')).toEqual([]);
  });
});
