export interface SseEvent {
  event: string;
  data: string;
}

/**
 * A server-sent events parser for text arriving in chunks of any size. Each call takes the next chunk and
 * returns the events it completed. Follows the WHATWG rules the API needs: `event` and `data` fields,
 * comments (lines starting with `:`) ignored, frames ended by a blank line, LF, CRLF or CR line endings.
 */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  return (chunk) => {
    buffer += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      const end = buffer.search(/\r\n|\r|\n/);
      if (end < 0) break;
      // A CR at the very end may be the first half of a CRLF: wait for the next chunk.
      if (buffer[end] === '\r' && end === buffer.length - 1) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + (buffer.startsWith('\r\n', end) ? 2 : 1));

      if (line === '') {
        if (data.length) out.push({ event: event || 'message', data: data.join('\n') });
        event = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return out;
  };
}

/** How long to wait before reconnect number `attempt` (from 0): 1 s, doubling, at most 30 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}
