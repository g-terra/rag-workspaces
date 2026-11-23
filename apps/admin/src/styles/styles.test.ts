import type { ResponseStyle } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { isGone, NO_STYLE, styleChoices, styleRequest, WORKSPACE_DEFAULT } from './styles';

const style = (slug: string, name: string, builtIn = true): ResponseStyle => ({
  slug,
  name,
  description: `${name} answers.`,
  instructions: '…',
  builtIn,
});
const styles = [style('academic', 'Academic'), style('socratic', 'Socratic', false)];

describe('styleRequest', () => {
  it("leaves the style out for the workspace's default, so the API applies it", () => {
    expect(styleRequest(WORKSPACE_DEFAULT)).toEqual({});
  });

  it('sends null for no style, which overrides a workspace default', () => {
    expect(styleRequest(NO_STYLE)).toEqual({ style: null });
  });

  it('sends a chosen slug', () => {
    expect(styleRequest('academic')).toEqual({ style: 'academic' });
  });
});

describe('styleChoices', () => {
  it("names the workspace's default first, then no style, then every style", () => {
    expect(styleChoices(styles, 'academic')).toEqual([
      { value: WORKSPACE_DEFAULT, label: 'Workspace default (Academic)' },
      { value: NO_STYLE, label: 'No style' },
      { value: 'academic', label: 'Academic' },
      { value: 'socratic', label: 'Socratic' },
    ]);
  });

  it('says when the workspace has no default', () => {
    expect(styleChoices(styles, null)[0]).toEqual({
      value: WORKSPACE_DEFAULT,
      label: 'Workspace default (none)',
    });
  });

  it("shows a default's slug when the list doesn't have it (not loaded yet, or deleted)", () => {
    expect(styleChoices([], 'gone')[0]!.label).toBe('Workspace default (gone)');
  });

  it('the no-style value can never be a real slug', () => {
    expect(NO_STYLE).not.toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
  });
});

describe('isGone', () => {
  it('spots a picked style that is no longer listed (deleted meanwhile)', () => {
    expect(isGone('removed', styles)).toBe(true);
    expect(isGone('academic', styles)).toBe(false);
    expect(isGone(WORKSPACE_DEFAULT, styles)).toBe(false);
    expect(isGone(NO_STYLE, styles)).toBe(false);
  });

  it('says nothing until the list has loaded', () => {
    expect(isGone('academic', undefined)).toBe(false);
  });
});
