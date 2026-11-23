import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { embeddingPrefixes } from './providers.js';

describe('embeddingPrefixes', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  it('knows the task prefixes nomic-embed-text was trained with', () => {
    expect(embeddingPrefixes('text-embedding-nomic-embed-text-v1.5', config)).toEqual({
      document: 'search_document: ',
      query: 'search_query: ',
    });
  });

  it('gives Qwen3-Embedding its query instruction and documents nothing', () => {
    expect(embeddingPrefixes('text-embedding-qwen3-embedding-4b', config)).toEqual({
      document: '',
      query: 'Instruct: Given a question, retrieve passages that answer the question\nQuery:',
    });
  });

  it('adds nothing for a model it does not know', () => {
    expect(embeddingPrefixes('text-embedding-3-small', config)).toEqual({ document: '', query: '' });
  });

  it('lets EMBEDDING_PREFIXES set or override them per model id', () => {
    const custom = loadConfig({
      NODE_ENV: 'test',
      EMBEDDING_PREFIXES: JSON.stringify({
        'text-embedding-nomic-embed-text-v1.5': { document: 'doc: ', query: 'q: ' },
        'my-model': { query: 'query: ' },
      }),
    });
    expect(embeddingPrefixes('text-embedding-nomic-embed-text-v1.5', custom)).toEqual({
      document: 'doc: ',
      query: 'q: ',
    });
    expect(embeddingPrefixes('my-model', custom)).toEqual({ document: '', query: 'query: ' });
  });

  it('refuses an EMBEDDING_PREFIXES that is not a JSON object of prefixes', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', EMBEDDING_PREFIXES: 'search_query: ' })).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test', EMBEDDING_PREFIXES: '{"m": {"query": 3}}' })).toThrow();
  });
});
