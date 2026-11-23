import type { Answer, Message } from '@rag/db';
import type { UsageDetail } from './log.js';

const cited = (citations: { documentId: string }[]) => [...new Set(citations.map((c) => c.documentId))];

/** What the usage log keeps about an answer. */
export function answerUsage(a: Answer): UsageDetail {
  return {
    question: a.question,
    answerId: a.id,
    model: a.model,
    grounded: a.grounded,
    promptTokens: a.promptTokens,
    completionTokens: a.completionTokens,
    timeToFirstTokenMs: a.timeToFirstTokenMs,
    citedDocumentIds: cited(a.citations),
  };
}

/** What the usage log keeps about a chat reply; `question` is the user's message. */
export function messageUsage(m: Message, question: string): UsageDetail {
  return {
    question,
    messageId: m.id,
    model: m.model,
    grounded: m.grounded,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    timeToFirstTokenMs: m.timeToFirstTokenMs,
    citedDocumentIds: cited(m.citations),
  };
}
