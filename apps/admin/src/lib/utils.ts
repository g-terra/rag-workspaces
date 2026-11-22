import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names and let later Tailwind classes override earlier ones (shadcn/ui helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A sidebar link, highlighted on its own page (for `NavLink`'s `className`). */
export const navItemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'hover:bg-accent flex h-8.5 items-center gap-2.5 rounded-md px-2.5 text-sm',
    isActive ? 'bg-accent font-semibold' : 'text-muted-foreground hover:text-foreground',
  );
