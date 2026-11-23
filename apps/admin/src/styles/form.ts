import { CreateStyle, StyleSlug, type ResponseStyle, type UpdateStyle } from '@rag/shared';

/** The create and edit dialogs' state, as the inputs hold it. */
export interface StyleForm {
  slug: string;
  name: string;
  description: string;
  instructions: string;
}
export type StyleField = keyof StyleForm;
export type StyleErrors = Partial<Record<StyleField | 'form', string>>;

export const emptyStyleForm = (): StyleForm => ({ slug: '', name: '', description: '', instructions: '' });

export const styleFormFor = (s: ResponseStyle): StyleForm => ({
  slug: s.slug,
  name: s.name,
  description: s.description,
  instructions: s.instructions,
});

/** A slug suggested from the name, so most people never type one: "Exam prep!" → "exam-prep". */
export function slugFor(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

const MAX = { name: 60, description: 200, instructions: 2000 } as const;

/** The checks both dialogs share, in the API's own limits (`CreateStyle`). */
function checkText(form: StyleForm, errors: StyleErrors) {
  if (!form.name.trim()) errors.name = 'Enter a name.';
  if (!form.instructions.trim()) errors.instructions = 'Write the instructions.';
  for (const field of ['name', 'description', 'instructions'] as const) {
    if (!errors[field] && form[field].trim().length > MAX[field]) {
      errors[field] = `Use at most ${MAX[field].toLocaleString('en')} characters.`;
    }
  }
}

type Checked<T> = { ok: true; body: T } | { ok: false; errors: StyleErrors };

/** `POST /v1/styles`. `taken` are the slugs already listed, built-ins included, so a clash shows here. */
export function validateNewStyle(form: StyleForm, taken: readonly string[] = []): Checked<CreateStyle> {
  const errors: StyleErrors = {};
  const slug = form.slug.trim();
  if (!StyleSlug.safeParse(slug).success)
    errors.slug = 'Use lowercase letters, digits and dashes (at most 40).';
  else if (taken.includes(slug)) errors.slug = `A style named “${slug}” already exists.`;
  checkText(form, errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: CreateStyle.parse({
      slug,
      name: form.name,
      description: form.description,
      instructions: form.instructions,
    }),
  };
}

/** `PATCH /v1/styles/{slug}` with only the fields that changed. The slug never changes. */
export function validateStyleEdit(form: StyleForm, style: ResponseStyle): Checked<UpdateStyle> {
  const errors: StyleErrors = {};
  checkText(form, errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  const body: UpdateStyle = {};
  for (const field of ['name', 'description', 'instructions'] as const) {
    if (form[field].trim() !== style[field]) body[field] = form[field].trim();
  }
  return { ok: true, body };
}
