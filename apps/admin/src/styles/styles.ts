import type { ResponseStyle } from '@rag/shared';

/** The picker's value for "whatever the workspace's default is": `style` is left out of the request. */
export const WORKSPACE_DEFAULT = '';
/** The picker's value for "no style", sent as `style: null`. Not a valid slug, so it can't collide. */
export const NO_STYLE = '-';

/** The part of an ask or chat body that picks the style. */
export function styleRequest(choice: string): { style?: string | null } {
  if (choice === WORKSPACE_DEFAULT) return {};
  return { style: choice === NO_STYLE ? null : choice };
}

/** The picker's options: the workspace's default (named), no style, then every style. */
export function styleChoices(
  styles: readonly ResponseStyle[],
  workspaceDefault: string | null,
): { value: string; label: string }[] {
  const named = workspaceDefault
    ? (styles.find((s) => s.slug === workspaceDefault)?.name ?? workspaceDefault)
    : 'none';
  return [
    { value: WORKSPACE_DEFAULT, label: `Workspace default (${named})` },
    { value: NO_STYLE, label: 'No style' },
    ...styles.map((s) => ({ value: s.slug, label: s.name })),
  ];
}

/**
 * Whether the picked style has left the list (deleted while the page was open). The picker then falls
 * back to the workspace default, so it never shows one choice and sends another. Unknown until loaded.
 */
export function isGone(choice: string, styles: readonly ResponseStyle[] | undefined): boolean {
  if (!styles || choice === WORKSPACE_DEFAULT || choice === NO_STYLE) return false;
  return !styles.some((s) => s.slug === choice);
}
