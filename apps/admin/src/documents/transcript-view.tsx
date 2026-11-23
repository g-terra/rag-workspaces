import type { Transcript } from '@rag/shared';
import { clock } from '@/playground/answer';

/** A recording's transcript, one Whisper segment per line with the time it starts at. */
export function TranscriptView({ transcript }: { transcript: Transcript }) {
  if (transcript.segments.length === 0)
    return <p className="text-muted-foreground text-[13px]">No speech was found in this recording.</p>;
  return (
    <ol className="flex max-h-80 flex-col gap-1.5 overflow-y-auto text-[13px] leading-snug">
      {transcript.segments.map((s, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs leading-5">
            {clock(s.start)}
          </span>
          <span>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}
