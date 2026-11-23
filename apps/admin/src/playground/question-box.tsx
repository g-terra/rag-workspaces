import type { ReactNode } from 'react';

/**
 * The card every playground mode types into: a label, a growable box, and a footer holding the mode's
 * own controls and its button. `Ctrl`/`Cmd`+`Enter` submits, as the mock's hint says.
 */
export function QuestionBox({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  children,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  children: ReactNode;
}) {
  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-3.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            // Otherwise the browser writes the newline into the box as well as submitting.
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        className="min-h-16 resize-y text-base leading-relaxed outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">{children}</div>
    </div>
  );
}

/** How many passages to ask for: "5 passages", "10 passages". */
export function Passages({
  value,
  onChange,
  counts,
  unit,
}: {
  value: number;
  onChange(value: number): void;
  counts: number[];
  unit: string;
}) {
  return (
    <select
      aria-label="Passages"
      className="border-input bg-background h-8 rounded-lg border px-2 text-[13px]"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {counts.map((n) => (
        <option key={n} value={n}>
          {n} {unit}
        </option>
      ))}
    </select>
  );
}
