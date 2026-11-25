# Nomic task prefixes: with and without

Does putting `search_document: ` and `search_query: ` before texts improve retrieval with
nomic-embed-text-v1.5 on the COS512 course material? Measured 2026-11-25 on the `cos512-ai` workspace's
4,560 passages. **Result: a modest gain, so the prefixes stay.**

## Retrieval: 146 generated questions

How often the passage a question was written from is in the top k:

| Search | Prefixes | Top 1 | Top 3 | Top 5 | Top 8 | MRR |
|---|---|---|---|---|---|---|
| App search (vectors + keywords) | With | 91 (62%) | 123 (84%) | 132 (90%) | 134 (92%) | 0.746 |
| App search (vectors + keywords) | Without | 88 (60%) | 115 (79%) | 127 (87%) | 133 (91%) | 0.714 |
| Vector search alone | With | 74 (51%) | 106 (73%) | 117 (80%) | 129 (88%) | 0.639 |
| Vector search alone | Without | 59 (40%) | 96 (66%) | 107 (73%) | 118 (81%) | 0.559 |

In the app's search, top 3: 10 questions were found only with prefixes and 2 only without (sign test,
p = 0.039). For vector search alone it is 16 and 6 (p = 0.052). Counting any passage from the same page or
next to the source gives 127 with and 119 without in the app's search. The 146 questions, their source and
the ranks are in [questions.md](questions.md).

## Answers: the 15-question set

Three runs per setting, top 3 passages. Verdicts are one reader's, against the expected answers of the
earlier COS512 tests. Q5, Q10, Q12, Q13 and half of Q7 are not in this course, so refusing them is right
here.

| | With | Without |
|---|---|---|
| Correct / partial / unstable of 15 | 14 / 0 / 1 | 13 / 1 / 1 |

- **Q4** (Floyd-Warshall: complexity, and when it cannot be used) was correct with prefixes and partial
  without: the passage on negative cycles was not retrieved, in all three runs.
- **Q11** ("How does it work?") was unstable in both: two of three runs said the material does not cover
  it, one described systems anyway.

## Method

- **Offline**, with no code or settings changed: passages were read from the API, embedded twice in LM
  Studio (with and without prefixes) and ranked by the code in
  `langflow/components/rag_workspaces/chroma_search.py` (exact cosine + BM25, fused).
- **Answers** used the app's default prompt and Qwen 3.6 35B (`qwen3.6-35b-a3b-splash`, reasoning none,
  temperature 0.2). With prefixes, the prompt token counts matched the app's on all 15 questions, which indicates
  the same context as the app sends.
- **Generated questions:** the same local chat model wrote a question for each of 148 random passages of 500
  or more characters (up to 60 from the textbook, up to 2 from each other file). It skipped 2, leaving 146.

## Caveats

- Generated questions come from the passages themselves and are not real student questions. One model
  wrote them, in one sample, and some are too vague to retrieve well (such as 25 and 26).
- The effect is modest (5 points at top 3 in the app's search), and keyword search hides part of it. The
  15 questions alone barely show it.
- Measured on one embedding model, one course and top 3. No separate in-app workspace was built without
  prefixes.
- Removing the prefixes would not remove the need for our LM Studio embeddings component:
  its code says Langflow's stock OpenAI Embeddings sends token arrays LM Studio rejects. Langflow
  1.13.3's newer "Embedding Model" node may avoid that; untested.
