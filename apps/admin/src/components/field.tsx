import type { ReactNode } from 'react';

/**
 * A labelled control with its hint or error below, in `<id>-note`; the control points at it with
 * `aria-describedby`, and an error is announced when it appears.
 */
export function Field(props: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const note = props.error ?? props.hint;
  return (
    <div>
      <label htmlFor={props.id} className="mb-1.5 block text-[13px] font-medium">
        {props.label}
      </label>
      {props.children}
      <p
        id={`${props.id}-note`}
        aria-live="polite"
        className={props.error ? 'text-destructive mt-1.5 text-xs' : 'text-muted-foreground mt-1.5 text-xs'}
      >
        {note}
      </p>
    </div>
  );
}
