---
title: walk first-time users through the admin app
date: 2026-11-23
pr: pending
status: proposed
areas: [admin, docs]
---

# Walk first-time users through the admin app

## Summary

The first time someone signs in to the admin UI in a browser, a short guided tour opens. It starts with a
welcome that explains workspaces, then points at the real sidebar items one by one: the workspace
switcher (switch, or create one with the wizard), Upload, Documents, Playground, Conversations, workspace
Settings, the admin pages (All workspaces, API keys, Usage, System) and finally a new **Help** button at
the bottom of the sidebar. Help replays the tour and links to the API docs. Skipping or finishing the
tour is remembered for that account in that browser.

## Why

Guilherme asked for "a walkthrough for when using for the first time" (project thread "Add first-time
walkthrough to the admin app", 2026-11-23). The admin UI (M4, `docs/work-breakdown.md`) now has many
screens and a create-workspace wizard (`2026-11-23-workspace-wizard.md`); a new user, or a marker of the
COS512 project, has nothing that says where to start or what a workspace is.

## Design

- **Steps** (`apps/admin/src/tour/steps.ts`): a fixed list of `{ id, target?, title, body }`. `target` is
  the value of a `data-tour` attribute on the element the step points at; a step without one (the
  welcome) shows centred. `nextStepIndex(steps, from, direction, exists)` finds the next step whose
  target is on screen now, so a step is skipped when its element isn't rendered: readers have no Upload
  or Usage link, non-admins have no Settings or Admin section, and nothing in the Workspace section exists
  outside a workspace. Targets are looked up when the step is reached, not when the tour starts, so links
  that render after the workspace list loads are still found. The `system` step points at the System link
  that the dashboard thread adds; until it exists the step is skipped.
- **Remembered** (`apps/admin/src/tour/seen.ts`): `localStorage` key `rw.tourSeen.<sub>`, where `sub` is
  the Keycloak user id from the OIDC profile. Reads and writes are wrapped in `try`, like
  `workspaces/landing.ts`: if storage is blocked the tour just shows again next time.
- **State** (`apps/admin/src/tour/tour.tsx`): `TourProvider` holds the current step index (or none) and
  exposes `start()` via `useTour()`. It sits inside `AppLayout`, so it only exists for signed-in pages.
  It starts the tour once the account (`me`) has loaded and the user hasn't seen it. Closing the tour by
  **Skip tour**, **Done** or Escape marks it seen.
- **Rendering** (`apps/admin/src/tour/walkthrough.tsx`): the current step is a Radix popover (the
  `@radix-ui/react-popover` the app already uses) anchored to the target with `PopoverAnchor`'s
  `virtualRef`, so it follows the element on scroll and resize and flips when there's no room. The target
  gets `data-tour-active`, which `index.css` outlines with the primary colour. The welcome step is a
  dialog (`components/ui/dialog.tsx`). Clicking outside a step does not close it, so a stray click doesn't
  lose the tour; Escape does. Each step shows "n of m" counted over the steps that are on screen.
- **Help menu** (`apps/admin/src/components/help-menu.tsx`): a `?` button in the sidebar footer, next to
  sign-out (`data-tour="help"`). Its popover has **Show the walkthrough** and **API docs** (`/api/docs/`).
- **Targets** (`components/app-layout.tsx`, `workspace-nav.tsx`, `workspace-switcher.tsx`): `data-tour`
  attributes on the switcher and nav links. They change nothing visible.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Build it on the Radix popover and dialog the app already has | A tour library (driver.js, react-joyride, shepherd) | About 150 lines; no new dependency (AGENTS.md rule 1); styling matches the shadcn components |
| A tour that points at the real sidebar | A static "getting started" checklist page | Shows where things are, which is what a first-time user is missing; Help → replay covers coming back to it |
| Remember per account in `localStorage` | A column on the user in Postgres plus a route | No API or migration for a hint; the cost is seeing the tour again in a new browser |
| Skip steps whose element isn't on screen | Branch on role and access in code | One rule covers role, access and route, and stays right when nav items change |
| Clicking outside doesn't close a step | Close on outside click | Accidental dismissal would lose the tour; Escape and Skip are explicit |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: browser `localStorage` key `rw.tourSeen.<sub>` = `"1"`. Delete it (or use Help → Show the
  walkthrough) to see the tour again.
- **Langflow**: None.
- **Events and logs**: None.
- `data-tour` values other code and tests rely on: `switcher`, `upload`, `documents`, `playground`,
  `conversations`, `settings`, `all-workspaces`, `api-keys`, `usage`, `system`, `help`.
- The e2e helper `signIn()` (`apps/admin/e2e/sign-in.ts`) now skips the tour after signing in, since every
  Playwright test starts in a fresh browser where it opens.

## Operations

None. Existing users see the tour once on their next sign-in in each browser.

## Testing

- `apps/admin/src/tour/steps.test.ts`: `nextStepIndex` forwards and backwards, skipping missing targets,
  untargeted steps always available, the end of the list; `stepPosition` counts only available steps.
- `apps/admin/src/tour/seen.test.ts`: the key is per user, marking and reading, and storage that throws.
- `apps/admin/e2e/walkthrough.spec.ts`: on first sign-in the tour opens, Next moves to the switcher with
  it outlined, Skip closes it and a reload doesn't bring it back; Help → Show the walkthrough replays it
  to **Done**.
- By hand: `pnpm smoke --keep`, open http://localhost:18080 in a private window, sign in with the login
  in `.env.smoke`, and step through. Open a workspace first to see the Workspace steps.

## Out of scope and follow-ups

- Remembering across browsers (would need the user record in the API).
- Steps inside pages (the wizard's own fields, the playground's modes); the tour stops at the sidebar.
- Separate tours per page or role-specific copy.

## Docs updated

`README.md`: one line on the walkthrough and the Help menu under the admin UI.
