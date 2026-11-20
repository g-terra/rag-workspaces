import { describe, expect, it } from 'vitest';
import { WorkspaceSlug } from './common.js';

describe('WorkspaceSlug', () => {
  it.each(['ouc', 'personal', 'cos-512', 'a1b'])('accepts %s', (slug) => {
    expect(WorkspaceSlug.safeParse(slug).success).toBe(true);
  });

  it.each(['ab', 'OUC', '1abc', 'abc-', 'a_b_c', 'x'.repeat(41), 'ws ouc'])('rejects %s', (slug) => {
    expect(WorkspaceSlug.safeParse(slug).success).toBe(false);
  });
});
