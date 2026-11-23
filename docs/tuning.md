# Tuning answer quality

How the `ouc` workspace was tuned, the settings that came out of it, and what was learned. Applied to `ouc`, the 15-question
set went from 10 correct, 1 partial and 4 wrong to 12 correct, 2 partial and 1 wrong.

## Method

Score retrieval and answers separately.

- **Retrieval:** list the evidence each question needs, and check that all of it is in the top k.
- **Answers:** run the same question set through `POST /v1/workspaces/<slug>/answers` before and after one change at a time,
  and read every answer against the expected one.

Use a copy workspace, so the live one keeps its index. Questions used to choose settings can't also be the proof: keep a
second set. One run per setting can't separate differences of a question or two.

## Recommended settings (local models, OUC course material)

The chunk size and overlap, top-k, minimum score and system prompt below are the defaults for workspaces that don't set
their own (`apps/api/src/config.ts`, `DEFAULT_SYSTEM_PROMPT` in `apps/api/src/services/generate.ts`). The default prompt
says "this workspace's material" instead of "course material".

| Setting                | Value                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat model             | `qwen3.6-35b-a3b-splash`, reasoning effort `none` (about 21 GB). Lighter: `openai/gpt-oss-20b` (about 12 GB); in one run each at the same settings it scored 12 against 13 of 15, with a 2.9 s median against 1.5 s |
| Embedding              | nomic-embed-text-v1.5 with task prefixes (set at create or reindex)                                                                                                                                         |
| Chunk size / overlap   | 1200 / 200                                                                                                                                                                                                  |
| Top-k                  | 8                                                                                                                                                                                                           |
| Minimum score          | 0.3 (not tuned; scores of unanswerable questions sit too close to answerable ones)                                                                                                                         |
| System prompt          | Ask for complete lists, every part answered, `[n]` citations, refusal without outside knowledge                                                                                                            |

## Lessons

- Approximate HNSW search dropped the best passages for a rare term, even with stronger settings; exact cosine fixed it
  (#89).
- On a sample of 2,779 passages, Qwen3-Embedding-4B (GGUF Q8_0 in LM Studio) ranked evidence worse than nomic and was
  about 15x slower. LM Studio warned about a missing end token, so this isn't a verdict on the model.
- Thinking models are slow unless reasoning is off.
- Load the chat and embedding models together (`lms load`), or LM Studio may swap them on every question.
- Known misses: vague questions ("How does it work?") still get answered; the question about how many targets most versions
  of the Mackworth clock test have still doesn't find the count.
