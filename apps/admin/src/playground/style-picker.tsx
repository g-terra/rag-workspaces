import { useStyles } from '@/styles/queries';
import { useEffect } from 'react';
import { isGone, styleChoices, WORKSPACE_DEFAULT } from '@/styles/styles';
import { useCurrentWorkspace } from '@/workspaces/current';

/**
 * The response style for the next question: the workspace's default, no style, or any style. Styles
 * change tone and length only; the answer still cites the material. Until the list loads it offers the
 * workspace default and no style, so asking is never blocked on it.
 */
export function StylePicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const w = useCurrentWorkspace();
  const styles = useStyles();
  const gone = isGone(value, styles.data);
  useEffect(() => {
    if (gone) onChange(WORKSPACE_DEFAULT);
  }, [gone, onChange]);
  return (
    <select
      aria-label="Response style"
      title="Tone and length of the answer. Citations and refusals apply in every style."
      className="border-input bg-background h-8 max-w-56 rounded-lg border px-2 text-[13px]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {styleChoices(styles.data ?? [], w.settings.style).map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
