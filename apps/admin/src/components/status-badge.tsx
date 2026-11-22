import type { Tone } from '@/documents/session';
import { cn } from '@/lib/utils';

// The status colours from the approved mocks.
const TONES: Record<Tone, string> = {
  waiting: 'bg-background text-muted-foreground border border-dashed',
  uploading: 'bg-background text-zinc-700 border',
  queued: 'bg-zinc-100 text-zinc-700',
  transcribing: 'bg-purple-100 text-purple-800',
  processing: 'bg-blue-100 text-blue-800',
  ready: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-amber-100 text-amber-800',
};
const BUSY: Tone[] = ['uploading', 'transcribing', 'processing'];

/** A pill with a dot; the dot pulses while work is going on. */
export function StatusBadge({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return (
    <span
      data-testid="status"
      className={cn(
        'inline-flex h-5.5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full bg-current', BUSY.includes(tone) && 'animate-pulse')} />
      {label}
    </span>
  );
}
