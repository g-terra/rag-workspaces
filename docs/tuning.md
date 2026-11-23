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

The default chat model is the lighter `openai/gpt-oss-20b`, so a new install fits more machines. The chunk size and
overlap, top-k, minimum score and system prompt below are the defaults for workspaces that don't set
their own (`apps/api/src/config.ts`, `DEFAULT_SYSTEM_PROMPT` in `apps/api/src/services/generate.ts`). The default prompt
says "this workspace's material" instead of "course material". A response style (`GET /v1/styles`) is added after
the prompt and repeats its grounding rules; the results above were measured without one.

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

## Response styles

Measured on 2026-11-23 on `ouc-tuning`, with the settings above (`qwen3.6-35b-a3b-splash`, reasoning effort
`none`, the OUC system prompt): the 15 questions, two more that aren't covered, another vague one, and two that are
partly covered. One run each; three of the uncovered ones (Kubernetes, GDPR, World Cup) were asked three more times for academic, talkative and tutor. The
verdicts are one reader's. The set was also used for tuning, so differences of a question are within noise.

| Style     | Correct / partial / wrong of 15 | Median answer | Average words | Refusals                                                                                     |
| --------- | ------------------------------- | ------------- | ------------- | -------------------------------------------------------------------------------------------- |
| None      | 13 / 1 / 1                      | 1.6 s         | 62            | All four refused, `grounded: false`                                                          |
| Academic  | 13 / 1 / 1                      | 2.2 s         | 134           | All refused, but two cite passages about other topics, so `grounded: true`                   |
| Talkative | 13 / 1 / 1                      | 3.4 s         | 243           | GDPR, World Cup and photosynthesis refused; **Kubernetes answered with RAG material**        |
| Concise   | 13 / 2 / 0                      | 1.6 s         | 34            | All refused, `grounded: false`                                                               |
| Tutor     | 12 / 2 / 1                      | 2.2 s         | 106           | GDPR, World Cup and Kubernetes refused, `grounded: false`; photosynthesis refused but cited  |

- **Citations:** every answer to a covered question cites, in `[n]` form, in every style.
- **Partly covered:** all five runs answered the covered half and said the other half isn't covered.
- **Vague ("How does it work?"):** talkative asked what was meant; concise said no single subject is named; without a
  style it said the same, then described two systems; academic and tutor described several systems. On "What are the steps?", none
  asked.
- **Known misses:** every style misses the Mackworth target count. Tutor also says Floyd-Warshall "requires" negative weights;
  concise drops the Fano factor definition.
- **Talkative and uncovered questions:** asked for a Kubernetes ingress, talkative gave a RAG walk-through (`grounded: true`).
  On three repeats it was `grounded: true` each time, and two opened as another RAG walk-through. The style's warmth seems to
  outweigh the refusal rule. Use it with that in mind, or strengthen the rule in its instructions.
- **Academic refusals:** they sometimes list what the passages do cover, with citations, so `grounded` says `true`.
  Don't count refusals by `grounded` for that style.

### Recheck after #127

#127 tightened the talkative and academic instructions and told both to cite nothing when refusing. Rerun on 2026-11-24 (local
time) with the same settings: the same 20 questions once per style, then Kubernetes and World Cup three times each.

| Style     | Correct / partial / wrong of 15 | Median answer | Average words | Kubernetes, 3 repeats                                                    | World Cup, 3 repeats                |
| --------- | ------------------------------- | ------------- | ------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Academic  | 14 / 1 / 0                      | 2.1 s         | 100           | Refused 3 of 3; `grounded: false` once, `true` twice                     | Refused 3 of 3; `grounded: true` 3 of 3 |
| Talkative | 14 / 1 / 0                      | 3.2 s         | 204           | Refused once, asked for more information once, gave a RAG walk-through once; `grounded: true` 3 of 3 | Refused 3 of 3; `grounded: false`   |

- **Academic still cites while refusing.** In the run of 20 it cited on Kubernetes and the World Cup, and it did so in 5 of the 6
  repeats. It often describes what the passages do cover.
- **Talkative still answers Kubernetes sometimes** (1 of 3 repeats as a RAG walk-through; its answer in the run of 20 refused but
  cited). Other refusals often still add a second sentence.
- The scores rose by one against the earlier run (academic on "How does it work?", talkative on Kubernetes), which is within noise.
- Stronger wording alone has not fixed it here. A check on the answer, or a search that rejects passages about another topic, is
  more likely to.
