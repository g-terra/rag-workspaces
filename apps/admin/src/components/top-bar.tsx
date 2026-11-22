import { Fragment } from 'react';
import { Button } from '@/components/ui/button';

/** The strip above every page: where you are, and the API's Swagger docs. */
export function TopBar({ trail }: { trail: string[] }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-6 py-2">
      <p className="text-muted-foreground text-sm">
        {trail.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-muted-foreground/60"> / </span>}
            <span className={i === trail.length - 1 ? 'text-foreground font-medium' : undefined}>{part}</span>
          </Fragment>
        ))}
      </p>
      <Button variant="outline" size="sm" asChild>
        <a href="/api/docs/">API docs</a>
      </Button>
    </div>
  );
}
