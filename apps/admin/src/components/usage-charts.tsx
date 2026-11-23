import type { TimeseriesPoint } from '@rag/shared';
import { useState, type ReactNode } from 'react';
import { axisTicks, barHeights, linePoints, niceMax, soleMarker } from '@/usage/chart';
import { bucketLabel, formatCount, formatDuration } from '@/usage/range';
import { cn } from '@/lib/utils';

/**
 * The two charts from the approved mock, as plain HTML and one SVG polyline: one series each, so no
 * legend is needed (the card's title names it). Values are reachable without a pointer, through the
 * readout and a table for screen readers, so hover only adds speed.
 */

interface ChartProps {
  points: TimeseriesPoint[];
  interval: 'hour' | 'day';
  /** Shown while a range change is in flight: the chart holds its last render, faded. */
  stale?: boolean;
}

export function RequestsChart({ points, interval, stale }: ChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const values = points.map((p) => p.requests);
  const max = niceMax(values);
  const heights = barHeights(values, max);
  const at = hovered ?? values.length - 1;
  const total = values.reduce((n, v) => n + v, 0);

  return (
    <ChartFrame
      title={interval === 'hour' ? 'Requests per hour' : 'Requests per day'}
      readout={
        points[at] ? `${bucketLabel(points[at].bucket, interval)} · ${formatCount(values[at]!)} requests` : ''
      }
      ticks={axisTicks(max).map(formatCount)}
      labels={points.map((p) => bucketLabel(p.bucket, interval))}
      stale={stale}
      table={{
        heading: 'Requests',
        rows: points.map((p) => [bucketLabel(p.bucket, interval), formatCount(p.requests)]),
      }}
      plot={
        <div
          className="absolute inset-0 flex gap-0.5"
          role="img"
          aria-label={`Requests per ${interval}: ${formatCount(total)} in total, at most ${formatCount(Math.max(0, ...values))} in one ${interval}.`}
        >
          {points.map((p, i) => (
            <div
              key={p.bucket}
              className="flex flex-1 cursor-default items-end justify-center"
              onPointerEnter={() => setHovered(i)}
              onPointerLeave={() => setHovered(null)}
            >
              <div
                className={cn('bg-chart-1 w-full max-w-6 rounded-t', i === at && 'brightness-90')}
                style={{ height: `${heights[i]!.toFixed(1)}%` }}
              />
            </div>
          ))}
        </div>
      }
    />
  );
}

export function LatencyChart({ points, interval, stale }: ChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  // A bucket with no requests has no percentile at all, so it is a gap in the line, not a zero.
  const values = points.map((p) => p.latencyP95Ms);
  const measured = values.filter((v) => v !== null);
  const max = niceMax(measured);
  const marker = soleMarker(values, max);
  const at = hovered ?? values.length - 1;

  return (
    <ChartFrame
      title="p95 latency"
      readout={
        points[at]
          ? `${bucketLabel(points[at].bucket, interval)} · ${formatDuration(points[at].latencyP95Ms)}`
          : ''
      }
      ticks={axisTicks(max).map((ms) => formatDuration(ms))}
      labels={points.map((p) => bucketLabel(p.bucket, interval))}
      stale={stale}
      table={{
        heading: 'p95 latency',
        rows: points.map((p) => [bucketLabel(p.bucket, interval), formatDuration(p.latencyP95Ms)]),
      }}
      plot={
        <>
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`95th percentile latency per ${interval}, up to ${formatDuration(measured.length ? Math.max(...measured) : null)}.`}
          >
            <polyline
              points={linePoints(values, max)}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {/* One measured bucket in the range: a dot, since a line would claim the quiet days too. */}
          {marker && (
            <span
              aria-hidden
              className="bg-chart-1 ring-card absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full ring-2"
              style={{ left: `${marker.x}%`, bottom: `${marker.y}%` }}
            />
          )}
          {/* The crosshair: the reader aims at a bucket, not at a 2px line. */}
          <div className="absolute inset-0 flex">
            {points.map((p, i) => (
              <div
                key={p.bucket}
                className={cn('flex-1', i === at && 'bg-chart-1/8 border-border border-l')}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered(null)}
              />
            ))}
          </div>
        </>
      }
    />
  );
}

function ChartFrame(props: {
  title: string;
  readout: string;
  ticks: string[];
  labels: string[];
  plot: ReactNode;
  table: { heading: string; rows: [string, string][] };
  stale?: boolean;
}) {
  const ends = [props.labels[0], props.labels[Math.floor(props.labels.length / 2)], props.labels.at(-1)];
  return (
    <div className={cn('bg-card rounded-xl border', props.stale && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-[15px] font-semibold">{props.title}</h2>
        <p className="text-muted-foreground text-[13px]" aria-live="polite">
          {props.readout}
        </p>
      </div>
      <div className="px-5 pt-4 pb-3">
        <div className="flex gap-2">
          <div className="text-muted-foreground flex h-40 w-12 flex-col justify-between text-right text-[11px]">
            {props.ticks.map((tick, i) => (
              <span key={i}>{tick}</span>
            ))}
          </div>
          <div className="border-border relative h-40 flex-1 border-b">
            <div className="border-border/60 absolute inset-x-0 top-0 border-t" />
            <div className="border-border/60 absolute inset-x-0 top-1/2 border-t" />
            {props.plot}
          </div>
        </div>
        <div className="text-muted-foreground mt-1.5 ml-14 flex justify-between text-[11px]">
          {ends.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      </div>
      {/* Every value, for anyone not using a pointer. */}
      <table className="sr-only">
        <caption>{props.title}</caption>
        <thead>
          <tr>
            <th>Bucket</th>
            <th>{props.table.heading}</th>
          </tr>
        </thead>
        <tbody>
          {props.table.rows.map(([bucket, value]) => (
            <tr key={bucket}>
              <td>{bucket}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Requests by route": a horizontal bar per group, longest first, with its share of the busiest. */
export function RouteBars({ totals }: { totals: { group: string; requests: number }[] }) {
  const top = Math.max(1, ...totals.map((t) => t.requests));
  return (
    <div className="flex flex-col gap-3">
      {totals.map((t) => (
        <div key={t.group} className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1">
          <span className="text-foreground truncate font-mono text-xs" title={t.group}>
            {t.group}
          </span>
          <span className="text-right text-[13px] font-medium">{formatCount(t.requests)}</span>
          <div className="col-span-2 h-2.5">
            <div
              className="bg-chart-1 h-2.5 rounded-r"
              style={{ width: `${((t.requests / top) * 100).toFixed(1)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
