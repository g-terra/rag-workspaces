---
title: Workspace settings in the admin UI
date: 2026-11-23
pr: pending
status: proposed
areas: [admin, shared]
---

# Workspace settings in the admin UI

## Summary

`/w/<slug>/settings` lets an admin change a workspace's name and description, the chat model and the
retrieval settings the Langflow flows read, and start a reindex. The chat provider and model are
picked from `GET /v1/system`, so the page offers the providers the API actually has keys for and the
models each one currently serves, and names the `.env` defaults an empty field falls back to. The
embedding model is shown but changed only through the reindex dialog, which is what the API allows.
`packages/shared/src/workspaces.ts` gains the inferred `ChatProvider` and `EmbeddingProvider` types.

## Why

Milestone M4 in `docs/work-breakdown.md` ("workspace settings, members, delete"). The routes have
existed since `2026-11-20-workspaces.md`, with the reindex route added by
`2026-11-23-workspace-reindex.md` and the system status by `2026-11-23-system-status.md`; until now
the only way to change a workspace after creating it was Swagger. Layout and copy follow the approved
"Workspace settings" mock.

Members and deleting a workspace are the same screen in the mock but a separate PR, to keep this one
inside the size rule (AGENTS.md rule 2).

## Design

1. **Route, nav and the gate** (`src/router.tsx`, `src/components/workspace-nav.tsx`,
   `src/routes/workspace-settings.tsx`). `settings` is a child of `w/:slug`, so `WorkspaceLayout`
   has already loaded the workspace. The page is **admins only**: `PATCH /v1/workspaces/{slug}`, the
   reindex route, the member routes and `DELETE` all call `requireWorkspace(..., 'admin')`, and
   `accessTo` only ever returns `admin` for a global admin. The mock's "Editors and admins can change
   these" is therefore wrong, and the page says so plainly — the workspace nav shows "Settings" only
   when `access === 'admin'`, and reaching the URL without it shows a notice instead of a form whose
   every save would 403.
2. **The form** (`src/workspaces/settings.ts`, no React, unit-tested). `formFor()` turns the
   workspace into nine strings, because that is what an input holds; a setting left to the global
   default is an empty field, which is what `null` means to the API. `isDirty()` compares the trimmed
   fields against the loaded workspace and is what enables "Save changes". `validateSettings()`
   checks the fields with the API's own schemas and builds the `PATCH` body **from the changed fields
   only**, so saving a renamed workspace does not rewrite its settings. The body never carries
   `embeddingProvider` or `embeddingModel`: `UpdateWorkspace` is `.strict()` and refuses them.
3. **Two rules the API's shape forces.**
   - `chatEndpoint()` (`apps/api/src/services/providers.ts`) resolves the provider and the model
     *independently*, each falling back to its own `.env` default. A workspace with a provider and no
     model would therefore be answered by that provider using another provider's default model. The
     form sends **both or neither**: choosing a provider requires a model, and a model requires a
     provider, each reported under its own field.
   - The model the *form* holds stays on offer even when the chosen provider does not list it
     (`modelChoices()` puts it first), so a model typed while the status was unavailable, or one the
     provider has stopped serving, does not vanish from the field that holds it. It is pinned on the
     form's value, never on the saved one: a model belongs to the provider it was chosen under, and
     offering a saved model under a newly picked provider would build exactly the mismatched pair the
     rule above exists to prevent. Changing the provider therefore clears the model.
4. **The pickers** (`src/system/queries.ts`, `src/workspaces/settings.ts`). `useSystem()` reads
   `GET /v1/system` once a minute at most — it asks four providers for their model lists, so it is
   not a cheap call. `chatProviderChoices()` labels a provider with why it may not work ("no API key
   set", "not reachable"); `defaultsNote()` names the `.env` default under the empty field, marked
   when its provider cannot serve it right now. If the system status cannot be read at all, the page
   says so, offers every provider the API's enum accepts, and asks for the model as **text** — a
   workspace must not be locked out of a model this page happens not to be able to list.
   `hostedWarning()` says, beside the picker, that a hosted provider receives this workspace's
   questions and the passages retrieved to answer them, so its material leaves the machine
   (`docs/decisions.md` #19).
5. **Reindex** (`src/components/reindex-dialog.tsx`, `src/workspaces/queries.ts`). One dialog for the
   one route: run every document through ingestion again with the settings the workspace has now, or
   switch it to another embedding model, which a reindex is the only way to do. It opens on the
   provider and model in use, so confirming it unchanged just redoes the chunking. The provider is a
   select of the ones that are configured, answered and can embed (`embeddingProviderChoices()`, with
   the one in use always included and all of them offered when the status could not be read); the
   model is a **text field with the provider's catalogue as suggestions**, because `GET /v1/models`
   does not say which models embed — `ProviderStatus.embeddings` is a fact about the provider, not
   about each model — so the field says what the list is rather than pretending it is filtered, and
   a model the list omits can still be named. Its warning is its own (`hostedEmbeddingWarning()`):
   embedding sends the text of *every* document, not the passages one question retrieves.
   The button on the page is disabled while the form has unsaved changes, because a reindex ingests
   with the settings the workspace has when it starts. `useWorkspace()` gained
   a `refetchInterval` that polls every 5 s while `status === 'reindexing'`, because a reindex has no
   completion event of its own — the workspace returns to `active` when its last document finishes —
   and the page shows a banner meanwhile and disables the button, since a second reindex answers 409.
6. **Saving.** The form is filled once and then belongs to the person typing, so a background
   refetch cannot overwrite what they are in the middle of writing. The page also keeps the workspace
   the form was filled *from*, and measures "changed" against that snapshot rather than the live copy:
   against the live copy, a rename saved in another tab would read as this person's edit and be sent
   back, undoing it. A successful save refills the form and the snapshot from the workspace the API
   returned, which both shows anything it normalised and leaves the form clean.
   `useUpdateWorkspace` writes that answer into the cache and invalidates `['workspaces']`, so the
   switcher and the breadcrumb show the new name at once.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Admins only, with a notice for everyone else | Show the form to editors as the mock does | Every route behind this screen requires `admin`; an editor's every save would 403, and a form that cannot save is worse than a sentence saying who can |
| Chat provider and model sent as a pair | Let each fall back on its own, as the API does | The API resolves them separately, so half a pair answers with one provider and another provider's default model — a wrong answer that looks like a working one |
| Keep an unlisted model on offer, pinned on the form's value | Pin the saved model; let the select fall back to "Default" | A model must not vanish from the field holding it; pinning the *saved* one would offer it under a newly chosen provider, which is the mismatched pair the rule above forbids |
| The embedding model is typed, with the provider's list as suggestions | A select of that list | `embeddings` is a provider-level flag and `/v1/models` returns the provider's whole catalogue, so a select would claim a filter that does not exist and let an admin pick a chat model — which only fails after the collection has been emptied and every document requeued |
| Measure "changed" against the snapshot the form was filled from | Against the live, polled workspace | Otherwise a save elsewhere becomes this person's edit and is sent back, silently undoing it |
| Reindex disabled while the form is dirty | Only the copy warning | A reindex ingests with the saved settings, so unsaved chunking would need a second destructive run |
| Fall back to a text field when nothing can be listed | Disable the field; block the page on `/v1/system` | The system status is admin-only, cached and can fail; the model is a plain string to the API, so typing it must stay possible |
| Only the changed fields in the `PATCH` body | Send the whole settings object | A full body rewrites every setting from fields a person never touched, and would fight anyone editing the same workspace |
| Empty field = the global default | A separate "use default" checkbox per field | `null` already means that in `WorkspaceSettings`, and the hint names what the default is |
| Overlap checked against the chunk size | Leave it to the API | Both pass the API's schemas separately, but an overlap as wide as the chunk leaves ingestion with no progress to make; only checked when both are set, since a default this page isn't told cannot be compared |
| Reindex behind a dialog | A button that starts it at once | It empties the collection and pauses asking and search for the whole workspace; it is also where the embedding model changes |
| A separate warning for a hosted embedding provider | Reuse the chat one | Embedding ships every document's full text, not the passages one question retrieves; the chat wording understates it at the one point the whole corpus leaves |
| Poll the workspace while reindexing | A spinner until the page is reloaded by hand | There is no reindex event; the workspace's own `status` is the signal, and 5 s is cheap against one row |
| The form is not refilled by a refetch | Re-derive it from the query on every render | A poll or another screen's invalidation would wipe half-typed text |
| Members and delete in a later PR | One PR for the whole mock | Rule 2: this is already at the top of the 200–600 line range |

## Interfaces and contracts

- **HTTP API**: none changed. The UI reads `GET /v1/workspaces/{slug}` and `GET /v1/system`, and
  calls `PATCH /v1/workspaces/{slug}` and `POST /v1/workspaces/{slug}/reindex` (202, 409 while one is
  running, 422 for a provider whose key is not set).
- **Configuration**: none.
- **Data**: none.
- **Langflow**: none. The settings this page writes are the ones the flows already read as tweaks.
- **Events and logs**: none.
- **Shared package**: `packages/shared/src/workspaces.ts` now exports the types `ChatProvider` and
  `EmbeddingProvider` beside the enums (the other modules already did).

## Operations

Existing installs: `docker compose up -d --build web`. Nothing to migrate. A reindex started from
this page is the same operation as the API route's, so `2026-11-23-workspace-reindex.md` covers its
recovery: if it fails, documents are left `failed` and the workspace returns to `active`, and
starting it again is safe.

## Testing

- `apps/admin/src/workspaces/settings.test.ts` (45 cases): `formFor` both ways, `isDirty` including
  whitespace, a body carrying only what changed, an emptied field sent as `null`, the provider/model
  pair refused half-set in either direction, the overlap rule and the case it cannot judge, every
  range message in words, a non-number and a fraction, the provider notes with and without a system
  status, `modelChoices` keeping an unlisted current model and giving nothing for a provider that did
  not answer, `hostedWarning` for hosted providers only and `hostedEmbeddingWarning` saying more,
  `embeddingProviderChoices` dropping providers that are unconfigured, unreachable or cannot embed
  while never dropping the one in use, `chatDefaultNote` including an unavailable default, and the
  API's answers to a save and a reindex in words.
- `apps/admin/e2e/workspace-settings.spec.ts` (3 tests, real stack): a throwaway workspace per run.
  The first changes the name and two numbers, sees "Settings saved.", reloads and finds them kept,
  then empties a number and finds the field back to its "Default" placeholder. The second checks that
  a provider with no model, an overlap as wide as the chunk, and a top-k above the API's maximum are
  each refused in the browser, and that reloading shows the workspace untouched — nothing reached the
  API. The third opens the reindex dialog on the model in use, reindexes an empty workspace, sees it
  ready for another run, and then sees the button disabled once a field is edited but unsaved. Each
  deletes its workspace afterwards.

By hand: open a workspace's Settings, pick a hosted provider and check the notice names it; clear the
chat provider and check the model field empties with it. Upload a document, then reindex and watch the
banner appear and the page return to normal by itself. As an editor (not an admin), `/w/<slug>/settings`
should say admins only, and "Settings" should be absent from the workspace nav.

## Out of scope and follow-ups

Members and deleting a workspace, both in the mock, are the next PR. Also from the mock: the
reindexing banner's "12 of 42 documents" progress (the workspace carries only a status; a count would
mean paging the documents list and aggregating it in the browser) and the member-role inline select.
An API that said which of a provider's models can embed would let the reindex dialog offer a filtered
list instead of a typed field with suggestions; that belongs in `GET /v1/system`, not here.
Not here either: a "Test this model" action, per-field defaults shown inline for chunking (the API
does not report them), and chat-provider changes that need no reindex but do change existing answers.

## Docs updated

`README.md` (workspace settings in the admin UI) and `docs/api-schema.md` (the workspace and system
tables now name the screen that reads and writes these routes).
