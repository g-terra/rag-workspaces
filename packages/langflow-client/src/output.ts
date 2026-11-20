// Helpers for reading a run response. Langflow's run API returns every ChatOutput
// node's message; structured data (passages) arrives as a JSON string inside that
// message, wrapped in a ```json fence (POC finding F6).

export type RunOutput = {
  component_id?: string;
  results?: { message?: { text?: string } };
  outputs?: { message?: { message?: string } };
  messages?: { message?: string }[];
};

export type RunResponse = {
  session_id?: string;
  outputs?: { outputs?: RunOutput[] }[];
};

/** Every output in a run response, keyed by the id of the node that produced it. */
export function outputsByComponent(run: RunResponse): Record<string, RunOutput> {
  const out: Record<string, RunOutput> = {};
  for (const block of run.outputs ?? []) {
    for (const o of block.outputs ?? []) {
      if (o.component_id) out[o.component_id] = o;
    }
  }
  return out;
}

/** The text of one output, whichever of Langflow's shapes it came in. */
export function messageText(output: RunOutput | undefined): string {
  return (
    output?.results?.message?.text ??
    output?.outputs?.message?.message ??
    output?.messages?.[0]?.message ??
    ''
  );
}

/** Parse a JSON payload a flow sent as chat text, with or without a Markdown code fence. */
export function parseJsonMessage<T = unknown>(text: string): T {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return JSON.parse(fenced ? fenced[1]! : text) as T;
}
