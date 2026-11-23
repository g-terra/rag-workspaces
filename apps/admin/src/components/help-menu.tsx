import { BookOpen, CircleHelp, Compass } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTour } from '@/tour/tour-context';

const row = 'hover:bg-accent flex w-full items-center gap-2.5 rounded-md p-2 text-left text-[13px]';

/** The sidebar's `?` button: replay the first-time walkthrough, or open the API docs. */
export function HelpMenu() {
  const { start } = useTour();
  const [open, setOpen] = useState(false);
  const startWhenClosed = useRef(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help" data-tour="help">
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-56 p-1.5"
        // Start the walkthrough once the menu has finished closing. While its close animation played it was
        // still the top dismiss layer, and took an Escape meant for the walkthrough it had just opened.
        onCloseAutoFocus={(e) => {
          if (!startWhenClosed.current) return;
          startWhenClosed.current = false;
          e.preventDefault(); // the walkthrough takes focus, not the Help button
          start();
        }}
      >
        <button
          type="button"
          className={row}
          onClick={() => {
            startWhenClosed.current = true;
            setOpen(false);
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
