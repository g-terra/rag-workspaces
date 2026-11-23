---
title: Composite workspaces in the admin UI
date: 2026-11-23
pr: "#118"
status: in review
areas: [admin, docs]
---

# Composite workspaces in the admin UI

## Summary

Admins can create a composite workspace from the admin UI ("New composite" on All workspaces: name,
slug, description, and the source workspaces as checkboxes) and change its sources in Settings. A
composite's sidebar has no Upload or Documents, its Settings have no embedding model, chunking, relevance
threshold or reindex, and its Overview lists its sources. In the playground and conversations, a
citation or search hit found through a composite says which workspace it came from.

## Why

Third and last PR of the composite stack (`2026-11-23-composite-workspaces.md`,
`2026-11-23-composite-answers.md`, decision 25): the API can create and answer from composites, and
this makes them usable without curl.

## Design

- `apps/admin/src/workspaces/composite.ts`: `sourceChoices` (standard workspaces only, by name),
  `sourcesError` (two to ten), `validateComposite` (the dialog's fields through the API's own
  `CreateWorkspace` schema, with `kind: "composite"`), `sourceLabel` (the source's name for a passage
  found through a composite, its slug when the caller can't open it, `null` for the workspace asked).
- `apps/admin/src/components/composite-sources.tsx`: `CreateCompositeDialog` (slug suggested from the
  name as in the wizard; on success opens the new workspace) and `CompositeSourcesSettings` (its own
  "Save sources" button, a `PATCH` with `sources` only), sharing a `SourcePicker` of checkboxes.
- `routes/workspaces.tsx`: the "New composite" button, shown to admins once there are two standard
  workspaces; composite cards say what they combine.
- `components/workspace-nav.tsx`: Upload and Documents only for a standard workspace.
- `routes/workspace-settings.tsx`: embedding model, chunk size and overlap, relevance threshold and the
  Reindex section only for a standard workspace; a Sources section for a composite.
- `routes/workspace-home.tsx`: a Sources row.
- `playground/answer-view.tsx`: `SourceWorkspace` ("from OUC study") under a citation; used by Sources (ask,
  chat, stored conversations) and by search hits in `playground/search-panel.tsx`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A separate small dialog for composites | A "Composite" path in the five-step create wizard | The wizard's steps are models, embeddings and retrieval, which a composite mostly doesn't have, and the wizard is being reworked in another thread. Chat settings are set afterwards in Settings, as for any workspace. |
| Sources saved with their own button | Part of the main "Save changes" form | The main form diffs scalar settings; a list with its own save keeps that logic untouched. |
| Show the source only when it differs from the workspace asked | Always show it | For a standard workspace it is always the same and would be noise. |

## Interfaces and contracts

- **HTTP API**: None (uses `POST /v1/workspaces` with `kind`/`sources`, `PATCH` with `sources`, and
  `workspace` on citations and passages from the earlier PRs).
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None: ships with the admin UI image.

## Testing

- `apps/admin/src/workspaces/composite.test.ts`: source choices, validation (two to ten, missing name and
  slug), the source label.
- `apps/admin/e2e/composite.spec.ts` (Playwright on the smoke stack): create a composite from two
  workspaces through the dialog (refused with one), Overview lists the sources, no Upload or Documents in
  the sidebar, Settings shows Sources and no embedding model or reindex, and saving one source is refused.

## Out of scope and follow-ups

- Listing a composite's documents as the union of its sources' (the API has no such route).

## Docs updated

None needed: `docs/api-schema.md` already describes composites; the admin UI has no separate doc for
these screens.
