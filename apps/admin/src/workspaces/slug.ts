/**
 * A slug the API accepts (`WorkspaceSlug`), made from a workspace name: "Thesis Research" → `thesis-research`.
 * Empty when the name has no letters to start with.
 */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}
