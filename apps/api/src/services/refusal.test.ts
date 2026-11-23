import { describe, expect, it } from 'vitest';
import { NOT_FOUND_TEXT } from './generate.js';
import { isRefusal } from './refusal.js';

describe('isRefusal', () => {
  it.each([
    'The material does not cover configuring a Kubernetes ingress.',
    'The provided passages do not address the 2022 World Cup [1][2].',
    "I'm sorry, but the workspace's material doesn't cover that. The passages are about RAG pipelines [3].",
    'The material does not mention Kubernetes ingress; the passages discuss retrieval and generation 【1†L2】.',
    'Unfortunately, the documents contain no information about Kubernetes.',
    'This is not covered by the material [2].',
    "Great question! Unfortunately the material doesn't cover Kubernetes [1].",
    NOT_FOUND_TEXT,
  ])('a reply that opens by saying the material does not cover it: %s', (text) => {
    expect(isRefusal(text)).toBe(true);
  });

  it.each([
    'RAG retrieves passages first [1], then generates an answer from them [2].',
    'Langflow builds flows [1]. The material does not cover its pricing.',
    // A long answer that opens with what is missing and then answers the rest.
    'The material does not cover the exact date. It does explain the method in detail: first the passages are retrieved [1]. ' +
      'Then they are ranked by similarity [2]. Finally the model writes the answer and cites them [3]. ' +
      'This keeps the answer tied to the sources [4].',
    'Could you say which tool you mean?',
  ])('an answer, or a question back, is not a refusal: %s', (text) => {
    expect(isRefusal(text)).toBe(false);
  });
});
