import { useId, useLayoutEffect, useMemo } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { nextStepIndex, stepPosition, TOUR_STEPS } from './steps';

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
const exists = (target: string) => find(target) !== null;

interface Props {
  index: number;
  onMove(index: number): void;
  /** Skip, Done or Escape: the tour is over and remembered as seen. */
  onClose(): void;
}

/** The current step: a dialog for the welcome, otherwise a popover beside the element it explains. */
export function Walkthrough({ index, onMove, onClose }: Props) {
  const step = TOUR_STEPS[index]!;
  useLocation(); // re-render on navigation, so the target is looked up again
  const titleId = useId();
  // Read on every render, so the popover follows the element when the page changes under it.
  const el = step.target ? find(step.target) : null;

  // Outline the target. If it has gone (the page changed), move on to the next step that is on screen.
  useLayoutEffect(() => {
    if (!step.target) return;
    if (!el) {
      const next = nextStepIndex(TOUR_STEPS, index, 1, exists);
      if (next === null) onClose();
      else onMove(next);
      return;
    }
    el.setAttribute('data-tour-active', '');
    el.scrollIntoView({ block: 'nearest' });
    return () => el.removeAttribute('data-tour-active');
  }, [step, el, index, onMove, onClose]);

  const anchor = useMemo(() => ({ current: el }), [el]);

  const prev = nextStepIndex(TOUR_STEPS, index, -1, exists);
  const next = nextStepIndex(TOUR_STEPS, index, 1, exists);
  const { n, of } = stepPosition(TOUR_STEPS, index, exists);
  const footer = (
    <div className="flex items-center justify-between gap-2 pt-1">
      <span className="text-muted-foreground text-xs" data-testid="tour-position">
        {n} of {of}
      </span>
      <div className="flex gap-2">
        {next !== null && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Skip tour
          </Button>
        )}
        {prev !== null && (
          <Button variant="outline" size="sm" onClick={() => onMove(prev)}>
            Back
          </Button>
        )}
        <Button size="sm" onClick={() => (next === null ? onClose() : onMove(next))}>
          {next === null ? 'Done' : 'Next'}
        </Button>
      </div>
    </div>
  );
  // A stray click elsewhere shouldn't lose the tour; Escape and Skip are the ways out.
  const keepOpen = (e: Event) => e.preventDefault();
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (!step.target) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent onInteractOutside={keepOpen}>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription>{step.body}</DialogDescription>
          {footer}
        </DialogContent>
      </Dialog>
    );
  }
  if (!el) return null;
  return (
    <Popover open onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        aria-labelledby={titleId}
        onInteractOutside={keepOpen}
        className="flex w-80 flex-col gap-2"
      >
        <h2 id={titleId} className="font-semibold">
          {step.title}
        </h2>
        <p className="text-muted-foreground text-sm">{step.body}</p>
        {footer}
      </PopoverContent>
    </Popover>
  );
}
