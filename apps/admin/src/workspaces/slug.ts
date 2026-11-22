// Latin letters that Unicode doesn't split into a base letter plus an accent.
const SPELLED: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th' };

/**
 * A slug the API accepts (`WorkspaceSlug`), made from a workspace name: "Thesis Research" → `thesis-research`.
 * Empty when the name gives fewer than 3 usable characters (for example "AI", or a name in another
 * script), so the admin types one instead of getting a suggestion the API would refuse.
 */
export function suggestSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[ßæœøłđþ]/g, (c) => SPELLED[c]!)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug.length >= 3 ? slug : '';
}
