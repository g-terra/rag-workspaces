import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hostUrl, parseEnv, setEnv, splitModels } from './env-file.ts';

describe('parseEnv', () => {
  it('reads KEY=value lines and skips comments and blanks', () => {
    const env = parseEnv('# a comment\nA=1\n\nB=two=parts\nEMPTY=\n');
    assert.deepEqual(env, { A: '1', B: 'two=parts', EMPTY: '' });
  });
});

describe('setEnv', () => {
  it('changes lines in place, keeps comments and order, and appends new keys', () => {
    const before = '# models\nDEFAULT_CHAT_MODEL=old\nOPENAI_API_KEY=\nLOG_LEVEL=info\n';
    const after = setEnv(before, { DEFAULT_CHAT_MODEL: 'qwen3-8b', OPENAI_API_KEY: 'sk-1', NEW_ONE: 'x' });
    assert.equal(
      after,
      '# models\nDEFAULT_CHAT_MODEL=qwen3-8b\nOPENAI_API_KEY=sk-1\nLOG_LEVEL=info\n\n# Added by pnpm run setup\nNEW_ONE=x\n',
    );
  });

  it('returns the text unchanged when nothing differs', () => {
    const text = 'A=1\nB=2\n';
    assert.equal(setEnv(text, { A: '1' }), text);
  });
});

describe('splitModels', () => {
  it('tells embedding models from chat models by name', () => {
    assert.deepEqual(
      splitModels(['qwen2.5-7b-instruct', 'text-embedding-nomic-embed-text-v1.5', 'Qwen3-Embedding-4B']),
      {
        chat: ['qwen2.5-7b-instruct'],
        embedding: ['text-embedding-nomic-embed-text-v1.5', 'Qwen3-Embedding-4B'],
      },
    );
  });
});

describe('hostUrl', () => {
  it('turns the address containers use for the host into one the host can use', () => {
    assert.equal(hostUrl('http://host.docker.internal:1234/v1'), 'http://localhost:1234/v1');
    assert.equal(hostUrl('http://192.168.1.5:1234/v1'), 'http://192.168.1.5:1234/v1');
  });
});
