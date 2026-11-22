import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function Loading({ what }: { what: string }) {
  return (
    <p className="text-muted-foreground px-6 py-7 text-sm" role="status">
      Loading {what}…
    </p>
  );
}

/** A query failed: say why, and offer to try again. */
export function ErrorState({ title, error, onRetry }: { title: string; error: Error; onRetry(): void }) {
  return (
    <Notice title={title} body={error.message} alert>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </Notice>
  );
}

export function Notice(props: { title: string; body: string; alert?: boolean; children?: ReactNode }) {
  return (
    <div
      className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-8"
      role={props.alert ? 'alert' : undefined}
    >
      <h2 className="text-base font-semibold">{props.title}</h2>
      <p className="text-muted-foreground text-sm">{props.body}</p>
      {props.children}
    </div>
  );
}
