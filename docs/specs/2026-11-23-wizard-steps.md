---
title: guide the create-workspace wizard step by step
date: 2026-11-23
pr: "#100"
status: in review
areas: [admin]
---

# Guide the create-workspace wizard step by step

## Summary

The admin UI's **Create workspace** wizard (from [2026-11-23-workspace-wizard.md](2026-11-23-workspace-wizard.md))
now has five steps, **Basics**, **Chat**, **Embeddings**, **Retrieval** and **Review**, and leads the admin
through them in order. A hosted provider's key is asked for and checked before its models are offered; a
key checked on one step is reused on the other; **Next** stays on a step until it is complete; and the
workspace is created only from **Review**, which refuses while anything is unfinished. A timeline at the
top shows the steps and lets the admin go back to any of them.

## Why

The owner found the first wizard hard to follow: chat and embedding choices shared one step, the key
field appeared below both pickers, and **Create workspace** worked from any step, so a workspace could be
made half set up. The owner asked for: the chat provider first, clearly labelled as chat, then its key checked,
then the model and reasoning effort; then embeddings, reusing a key already checked (Gemini for chat means
no second Gemini key for embeddings); creation only at the review once everything is configured; and a
timeline that shows the steps and allows returning to them.

## Design

All in the admin app.

- `apps/admin/src/workspaces/wizard.ts` (pure, unit-tested):
  - `STEPS` is now `Basics, Chat, Embeddings, Retrieval, Review`, and `REVIEW` is the last index.
    `stepOf` maps every field to its step, including two key "fields", `chatKey` and `embeddingKey`.
  - `needsKey(provider, system, keys)` replaces `missingKeys`: a provider needs a key typed here when it is
    hosted, the system status says `.env` has none, and no key was checked in this wizard. The checked
    keys are one map by provider, so a key checked on either step counts for both.
  - `buildCreate` reports a missing key on the step that chose the provider (`chatKey` or
    `embeddingKey`), and still saves each key once, only for providers in use.
  - `stepErrors(step, …)` is what keeps the wizard on a step: that step's own problems, or every problem
    on **Review**.
- `apps/admin/src/components/create-workspace-dialog.tsx`:
  - **Timeline**: an ordered list of step buttons. Done steps show a check. Any earlier step can be
    opened; a later one only if it was reached before and no step before it has a problem.
  - **Next** (also Enter in a field) runs `stepErrors` and either moves on or shows that step's errors.
  - **Chat** step: an intro saying this is the model that writes answers, the provider, then
    `ProviderKey`. The model picker and reasoning effort appear only once no key is needed.
  - **Embeddings** step: the same shape. When the provider's key was checked on the other step, a note
    says it is reused and no field is shown.
  - **Review**: the summary, a list of anything unfinished with a link to its step, and **Create
    workspace**, disabled while that list is not empty. A create error on a field (a taken slug) opens
    that field's step.
  - Keys are still saved with `PUT /v1/workspaces/{slug}/providers/{provider}/key` after the workspace is
    created, as before.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Next validates and shows errors rather than being disabled | Disable Next until the step is valid | A disabled button doesn't say what is missing; the errors do. Create on Review is disabled because the list of problems is right above it. |
| One key map shared by both model steps, with a note instead of a second field | A key field on each step, pre-filled | The owner asked for no key at all the second time; one map also means one saved key. |
| Model and reasoning hidden until the key is checked | Show them disabled | The model list comes from the key check, so there is nothing to pick before it. |
| Timeline can jump forward only over complete steps | Free navigation | Reaching Review past an unfinished step would only send the admin back again. |

## Interfaces and contracts

- **HTTP API**: None. Uses the routes from #95 and #98 unchanged.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. A UI change only.

## Testing

- `apps/admin/src/workspaces/wizard.test.ts`: `buildCreate` (defaults send nothing, chosen settings and
  keys, first problem's step, provider and model together, a missing key reported on the chat or the
  embedding step, a key reused and saved once), `stepErrors` (only a step's own problems; everything on
  Review), `needsKey`, `modelsFor`, `stepOf`.
- `apps/admin/e2e/workspaces.spec.ts`: creating walks every step to Review; the wizard test picks Gemini
  for chat, sees the model hidden and Next refused for the missing key, sees a made-up key fail, switches
  to LM Studio and picks a model, then on Review uses the timeline to go back to Chat (model kept) and
  forward to Review before creating.
- By hand: `pnpm smoke --keep`, open the admin UI on port 18080, **New workspace**, and walk the steps.

## Out of scope and follow-ups

- No members step (as in the first wizard).
- Changing a reused key happens on the step where it was checked.

## Docs updated

None needed: `docs/api-schema.md` already describes the key-check route the wizard uses, and no other
doc describes the dialog's steps. The first wizard's spec is marked superseded by this one.
