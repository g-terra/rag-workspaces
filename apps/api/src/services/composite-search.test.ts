import { describe, expect, it } from 'vitest';
import { contextText, fuseSources, type SourceHit } from './composite-search.js';

const hit = (workspace: string, rank: number, score: number, over: Partial<SourceHit> = {}): SourceHit => ({
  workspace,
  workspaceName: workspace.toUpperCase(),
  rank,
  id: `psg_${workspace}_${rank}`,
  documentId: `doc_${workspace}`,
  documentTitle: `${workspace}.pdf`,
  page: null,
  startSeconds: null,
  chunkIndex: rank,
  text: `${workspace} ${rank}`,
  score,
  ...over,
});

describe('fuseSources', () => {
  it('takes turns between sources by rank, not by score, and renumbers 1..n', () => {
    const fused = fuseSources(
      [
        [hit('ouc', 1, 0.5), hit('ouc', 2, 0.45), hit('ouc', 3, 0.4)],
        [hit('personal', 1, 0.9), hit('personal', 2, 0.85)],
      ],
      4,
    );
    expect(fused.map((p) => [p.id, p.rank])).toEqual([
      ['psg_personal_1', 1],
      ['psg_ouc_1', 2],
      ['psg_personal_2', 3],
      ['psg_ouc_2', 4],
    ]);
  });

  it('breaks a tie between equal ranks by score', () => {
    const fused = fuseSources([[hit('a', 1, 0.3)], [hit('b', 1, 0.6)], [hit('c', 1, 0.4)]], 3);
    expect(fused.map((p) => p.workspace)).toEqual(['b', 'c', 'a']);
  });

  it('a source with nothing to say leaves the slots to the others', () => {
    const fused = fuseSources([[], [hit('b', 1, 0.6), hit('b', 2, 0.5), hit('b', 3, 0.4)]], 2);
    expect(fused.map((p) => p.id)).toEqual(['psg_b_1', 'psg_b_2']);
  });

  it('uses the rank each source gave, even when some of its hits were dropped', () => {
    // b's rank 1 was dropped (its document is not ready), so its first hit kept is rank 2.
    const fused = fuseSources([[hit('a', 1, 0.5), hit('a', 2, 0.4)], [hit('b', 2, 0.9)]], 3);
    expect(fused.map((p) => p.id)).toEqual(['psg_a_1', 'psg_b_2', 'psg_a_2']);
  });
});

describe('contextText', () => {
  it('numbers each passage and says which workspace, document and page or time it comes from', () => {
    const text = contextText([
      hit('ouc', 1, 0.5, { page: 3 }),
      hit('personal', 2, 0.5, { startSeconds: 75, documentTitle: 'talk.mp4' }),
    ]);
    expect(text).toBe('[1] (OUC: ouc.pdf, page 3)\nouc 1\n\n[2] (PERSONAL: talk.mp4, at 1:15)\npersonal 2');
  });

  it('says so when there is nothing', () => {
    expect(contextText([])).toBe('No relevant passages found.');
  });
});
