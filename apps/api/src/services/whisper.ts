import { openAsBlob } from 'node:fs';
import type { Transcript } from '@rag/shared';
import { z } from 'zod';

/** Whisper's JSON output; segments carry many more fields than we keep. */
const AsrOutput = z.object({
  language: z.string().nullish(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
});

/**
 * The Whisper ASR web service (`onerahmet/openai-whisper-asr-webservice`, compose profile `video`).
 * It takes video and audio as they are, since ffmpeg runs inside it, so the API needs no ffmpeg.
 */
export class WhisperClient {
  private readonly base: string;
  constructor(
    url: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  /** Transcribe one file from disk. The file is streamed, not read into memory. */
  async transcribe(file: string, fileName: string, signal?: AbortSignal): Promise<Transcript> {
    const form = new FormData();
    form.append('audio_file', await openAsBlob(file), fileName);
    const res = await this.fetchFn(`${this.base}/asr?task=transcribe&output=json&encode=true`, {
      method: 'POST',
      body: form,
      signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Transcription failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    const out = AsrOutput.parse(await res.json());
    const segments = out.segments
      .map((s) => ({ start: round(s.start), end: round(s.end), text: s.text.trim() }))
      .filter((s) => s.text);
    if (!segments.length) throw new Error('No speech was found in this file.');
    return { language: out.language ?? null, segments };
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
