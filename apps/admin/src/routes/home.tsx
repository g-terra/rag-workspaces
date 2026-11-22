import type { Ready } from '@rag/shared';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ApiState = 'checking' | Ready['status'] | 'unreachable';

/** Ask the API whether it and its dependencies are ready. */
async function fetchReadiness(): Promise<ApiState> {
  try {
    const res = await fetch('/api/ready');
    const body = (await res.json()) as Ready;
    return body.status;
  } catch {
    return 'unreachable';
  }
}

const LABELS: Record<ApiState, string> = {
  checking: 'Checking…',
  ok: 'Ready',
  unavailable: 'Not ready: a dependency is down',
  unreachable: 'API unreachable',
};

/** Landing page after sign-in. The workspace screens replace it in the next admin UI changes. */
export function Home() {
  const [state, setState] = useState<ApiState>('checking');
  const refresh = useCallback(() => {
    setState('checking');
    void fetchReadiness().then(setState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchReadiness().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full max-w-5xl space-y-6 px-6 py-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground mt-1 text-sm">You're signed in. This page checks the API.</p>
      </div>
      <section className="bg-card flex items-center justify-between rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'size-2.5 rounded-full',
              state === 'ok'
                ? 'bg-emerald-500'
                : state === 'checking'
                  ? 'bg-muted-foreground'
                  : 'bg-destructive',
            )}
          />
          <span className="text-sm">
            API status: <strong>{LABELS[state]}</strong>
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw /> Recheck
          </Button>
          <Button size="sm" asChild>
            <a href="/api/docs/">Open API docs</a>
          </Button>
        </div>
      </section>
    </div>
  );
}
