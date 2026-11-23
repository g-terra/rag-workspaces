import { useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { nextStepIndex, stepPosition, TOUR_STEPS } from './steps';

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

/**
 * Which `data-tour` targets are on screen, as an external store: links appear and disappear after React
 * commits (the workspace list loads, the person navigates), so the tour re-renders when the DOM does
 * rather than trusting what it saw during its own render.
 */
const targetsSnapshot = () =>
  Array.from(document.querySelectorAll('[data-tour]'), (el) => el.getAttribute('data-tour')).join(' ');
const subscribeTargets = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-tour'],
  });
  return () => observer.disconnect();
};

// The sidebar sits beside the page from this width (app-layout's flex-wrap); below it, it is on top.
const wide = window.matchMedia('(min-width: 800px)');
const subscribeWide = (onChange: () => void) => {
  wide.addEventListener('change', onChange);
  return () => wide.removeEventListener('change', onChange);
};

interface Props {
  index: number;
  onMove(index: number): void;
  /** Skip, Done or Escape: the tour is over and remembered as seen. */
  onClose(): void;
}

/** The current step: a dialog for the welcome, otherwise a popover beside the element it explains. */
export function Walkthrough({ index, onMove, onClose }: Props) {
  const step = TOUR_STEPS[index]!;
  const titleId = useId();
  const bodyId = useId();
  const nextButton = useRef<HTMLButtonElement>(null);
  const isWide = useSyncExternalStore(subscribeWide, () => wide.matches);
  const onScreen = useSyncExternalStore(subscribeTargets, targetsSnapshot);
  const exists = (target: string) => onScreen.split(' ').includes(target);
  const el = step.target && exists(step.target) ? find(step.target) : null;

  // Outline the target. If it has gone (the page changed), move on to the next step that is on screen.
  useLayoutEffect(() => {
    if (!step.target) return;
    const current = find(step.target);
    if (!current) {
      const next = nextStepIndex(TOUR_STEPS, index, 1, (t) => find(t) !== null);
      if (next === null) onClose();
      else onMove(next);
      return;
    }
    current.setAttribute('data-tour-active', '');
    current.scrollIntoView({ block: 'nearest' });
    return () => current.removeAttribute('data-tour-active');
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
        <Button ref={nextButton} size="sm" onClick={() => (next === null ? onClose() : onMove(next))}>
          {next === null ? 'Done' : 'Next'}
        </Button>
      </div>
    </div>
  );
  // A stray click elsewhere shouldn't lose the tour; Escape and Skip are the ways out.
  const keepOpen = (e: Event) => e.preventDefault();
  // Start on Next, not on the first button (Skip tour), so Enter on arrival doesn't end the tour.
  const focusNext = (e: Event) => {
    e.preventDefault();
    nextButton.current?.focus();
  };
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (!step.target) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent onInteractOutside={keepOpen} onOpenAutoFocus={focusNext}>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription>{step.body}</DialogDescription>
          {footer}
        </DialogContent>
      </Dialog>
    );
  }
  if (!el) return null;
  return (
    // Keyed by step, so each step opens afresh: focus moves to its Next and screen readers announce it.
    <Popover key={step.id} open onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side={isWide ? 'right' : 'bottom'}
        align="start"
        sideOffset={12}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onOpenAutoFocus={focusNext}
        onInteractOutside={keepOpen}
        className="flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <h2 id={titleId} className="font-semibold">
          {step.title}
        </h2>
        <p id={bodyId} className="text-muted-foreground text-sm">
          {step.body}
        </p>
        {footer}
      </PopoverContent>
    </Popover>
  );
}
