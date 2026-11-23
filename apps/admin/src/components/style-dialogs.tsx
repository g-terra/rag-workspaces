import type { ResponseStyle } from '@rag/shared';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  emptyStyleForm,
  slugFor,
  styleFormFor,
  validateNewStyle,
  validateStyleEdit,
  type StyleErrors,
  type StyleForm,
} from '@/styles/form';
import { useCreateStyle, useDeleteStyle, useUpdateStyle } from '@/styles/queries';

const textareaClass =
  'border-input dark:bg-input/30 min-h-32 w-full resize-y rounded-md border bg-transparent px-3 py-2.5 text-sm leading-relaxed shadow-xs';

/**
 * Create a custom style (no `style` given) or edit one. The slug is suggested from the name until it is
 * typed, and fixed once the style exists: answers and workspaces refer to it.
 */
export function StyleDialog({
  style,
  taken,
  onOpenChange,
}: {
  style?: ResponseStyle;
  taken: readonly string[];
  onOpenChange(open: boolean): void;
}) {
  const create = useCreateStyle();
  const update = useUpdateStyle(style?.slug ?? '');
  const pending = create.isPending || update.isPending;
  const [form, setForm] = useState<StyleForm>(() => (style ? styleFormFor(style) : emptyStyleForm()));
  const [slugTyped, setSlugTyped] = useState(false);
  const [errors, setErrors] = useState<StyleErrors>({});
  const done = {
    onSuccess: () => onOpenChange(false),
    onError: (err: Error) => setErrors({ form: err.message }),
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (style) {
      const checked = validateStyleEdit(form, style);
      if (!checked.ok) return setErrors(checked.errors);
      setErrors({});
      if (!Object.keys(checked.body).length) return onOpenChange(false);
      update.mutate(checked.body, done);
    } else {
      const checked = validateNewStyle(form, taken);
      if (!checked.ok) return setErrors(checked.errors);
      setErrors({});
      create.mutate(checked.body, done);
    }
  };
  const set = (field: keyof StyleForm) => (value: string) =>
    setForm((f) => ({
      ...f,
      [field]: value,
      ...(field === 'name' && !style && !slugTyped ? { slug: slugFor(value) } : {}),
    }));

  return (
    <Dialog open onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="gap-5 sm:max-w-150">
        <div className="space-y-1.5">
          <DialogTitle>{style ? `Edit “${style.name}”` : 'New response style'}</DialogTitle>
          <DialogDescription>
            Instructions for tone, length and format, added after the workspace's system prompt. They can't
            turn off citations or refusals. Every workspace can use the style.
          </DialogDescription>
        </div>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="style-name" label="Name" error={errors.name}>
              <Input
                id="style-name"
                aria-describedby="style-name-note"
                aria-invalid={!!errors.name}
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
              />
            </Field>
            <Field
              id="style-slug"
              label="Slug"
              error={errors.slug}
              hint={style ? "Can't change: answers refer to it." : 'What the API and agents send as style.'}
            >
              <Input
                id="style-slug"
                aria-describedby="style-slug-note"
                aria-invalid={!!errors.slug}
                className="font-mono"
                value={form.slug}
                disabled={!!style}
                onChange={(e) => {
                  setSlugTyped(true);
                  set('slug')(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field
            id="style-description"
            label="Description"
            error={errors.description}
            hint="One line, shown in the pickers."
          >
            <Input
              id="style-description"
              aria-describedby="style-description-note"
              aria-invalid={!!errors.description}
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
            />
          </Field>
          <Field
            id="style-instructions"
            label="Instructions"
            error={errors.instructions}
            hint="Written to the model, e.g. “Answer in short bullet points, then a one-line summary.”"
          >
            <textarea
              id="style-instructions"
              aria-describedby="style-instructions-note"
              aria-invalid={!!errors.instructions}
              className={textareaClass}
              value={form.instructions}
              onChange={(e) => set('instructions')(e.target.value)}
            />
          </Field>
          {errors.form && (
            <p role="alert" className="text-destructive text-sm">
              {errors.form}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : style ? 'Save changes' : 'Create style'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `DELETE /v1/styles/{slug}`. The API refuses (409) while a workspace uses it as its default, and says which. */
export function DeleteStyleDialog({
  style,
  onOpenChange,
}: {
  style: ResponseStyle;
  onOpenChange(open: boolean): void;
}) {
  const remove = useDeleteStyle(style.slug);
  return (
    <Dialog open onOpenChange={(next) => !remove.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>Delete “{style.name}”?</DialogTitle>
        <DialogDescription>
          Nobody can choose it any more. Answers already written in it keep its slug. A workspace that uses it
          as its default must switch first.
        </DialogDescription>
        {remove.error && (
          <p role="alert" className="text-destructive text-sm">
            {remove.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
          >
            {remove.isPending ? 'Deleting…' : 'Delete style'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
