import { BookOpen, CircleHelp, Compass } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTour } from '@/tour/tour-context';

const row = 'hover:bg-accent flex w-full items-center gap-2.5 rounded-md p-2 text-left text-[13px]';

/** The sidebar's `?` button: replay the first-time walkthrough, or open the API docs. */
export function HelpMenu() {
  const { start } = useTour();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help" data-tour="help">
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-56 p-1.5">
        <button
          type="button"
          className={row}
          onClick={() => {
            setOpen(false);
            start();
          }}
        >
          <Compass className="size-4" /> Show the walkthrough
        </button>
        <a href="/api/docs/" className={row}>
          <BookOpen className="size-4" /> API docs
        </a>
      </PopoverContent>
    </Popover>
  );
}
