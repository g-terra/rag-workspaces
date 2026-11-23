import { cn } from '@/lib/utils';

// The mock's tints. The slug picks one, so a workspace keeps its colour everywhere.
const TINTS = [
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
];

export function WorkspaceAvatar({
  name,
  slug,
  className,
}: {
  name: string;
  slug: string;
  className?: string;
}) {
  const tint = TINTS[[...slug].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 flex-none items-center justify-center rounded-md text-[13px] font-semibold',
        tint,
        className,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
