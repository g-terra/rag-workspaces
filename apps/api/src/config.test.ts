import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { DEFAULT_SYSTEM_PROMPT } from './services/generate.js';

describe('defaults for new workspaces', () => {
  it('are the values tuned on the OUC material (docs/tuning.md) when the environment sets none', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect({
      chunkSize: config.DEFAULT_CHUNK_SIZE,
      chunkOverlap: config.DEFAULT_CHUNK_OVERLAP,
      topK: config.DEFAULT_TOP_K,
      minScore: config.DEFAULT_MIN_SCORE,
    }).toEqual({ chunkSize: 1200, chunkOverlap: 200, topK: 8, minScore: 0.3 });
  });

  it('use gpt-oss-20b in LM Studio as the chat model (docs/tuning.md)', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect([config.DEFAULT_CHAT_PROVIDER, config.DEFAULT_CHAT_MODEL]).toEqual([
      'lmstudio',
      'openai/gpt-oss-20b',
    ]);
  });
});

describe('the default system prompt', () => {
  it('carries the tuned rules: every part, complete lists, [n] citations, no outside knowledge', () => {
    for (const rule of [
      'answer each part',
      'give the complete list',
      'like [1] or [2][3]',
      'Never use outside knowledge',
      'Ask the user what they mean',
      'Transcripts',
      'Answer in the language of the question',
    ]) {
      expect(DEFAULT_SYSTEM_PROMPT, rule).toContain(rule);
    }
  });
});
