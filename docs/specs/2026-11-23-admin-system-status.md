---
title: System status in the admin UI
date: 2026-11-23
pr: pending
status: proposed
areas: [admin]
---

# System status in the admin UI

## Summary

Admins now see one line above every page when something the API depends on is down — naming it and
saying what to do — and a `/system` page behind it with each service, each model provider and the
versions. The usual case is LM Studio not running, which until now showed up only as an answer that
failed with no visible cause. No API, configuration or data change: everything comes from
`GET /v1/system`.

## Why

Workstream 2, item 9 in `docs/work-breakdown.md`: "System status: a banner when the model provider,
Langflow or Chroma is down (most often LM Studio not running), with what to do about it."
`2026-11-23-system-status.md` added the route; this reads it. The approved mocks have no admin-wide
system screen — their closest relative is the workspace Dashboard's "Services" card — so the page
follows that card's shape (name, detail line, state pill) on an admin route, because the data is
global and admin-only rather than per workspace.

## Design

1. **What counts as a problem** (`src/system/status.ts`, no React, unit-tested). `firstProblem()`
   returns the one thing to put in front of an admin, or `null`. It only looks when the API itself
   says `status === 'degraded'`: the API decides what counts, and a UI that second-guessed it would
   fire on things the API is content with. Then services first, because everything depends on them,
   then the default chat and embedding models, which are the usual cause. One problem, not a list:
   a banner that lists four things gets ignored.
2. **What to do about it.** Each problem carries a `fix`. A service names its container and
   `docker compose logs <name>`; LM Studio says to start it and its local server, because it runs on
   the host and not in compose; a hosted provider with no key names the `.env` variable to set, and
   one with a key says to check this machine's network access. A service or provider this app has
   not met is still named, with the generic answer, rather than dropped — the API may add checks.
3. **The banner** (`src/components/system-banner.tsx`, rendered by `AppLayout`). Admins only; a
   non-admin never even asks, because `useSystem(enabled)` is off for them and the route is 403 to
   them anyway. It says nothing when `GET /v1/system` itself fails — that call is not the point of
   the page a person is on — and nothing on `/system`, which says the same thing in its own words
   right below. It carries a link to that page.
4. **The page** (`src/routes/system.tsx`). Two cards. *Services*: each check with how fast it
   answered or why it did not, plus where the API's Langflow key came from, which is what decides
   whether a Langflow restart breaks ingestion. *Model providers*: each provider with how many
   models it offers now or the reason it offers none, in three states rather than two — no key set,
   a key that did not work, and working — then the two defaults and the API version. "Check again"
   refetches; the status is re-measured by the API on every request.
5. **Refreshing** (`src/system/queries.ts`). `useSystem` gained `refetchInterval: 60_000` beside its
   existing minute of `staleTime`, so something that went down (or came back) while a page sat open
   reaches the banner without a reload. A minute is slow enough that four providers are not polled
   hard; the call asks each of them for its model list.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Trust the API's `degraded` | Decide in the browser from `services` and `defaults` | Two places deciding what "healthy" means drift apart; the API already publishes the verdict `/ready` uses |
| One problem in the banner | List every failure | A banner that lists four things is read as decoration; the page behind it has the list |
| Services before models | Models first, since they fail most | A model cannot be reached when Langflow or Chroma is down either, so the service is the real answer |
| A `fix` line per problem | Only name what is down | The item asks for "what to do about it"; "LM Studio isn't reachable" is not actionable to someone who does not know it runs on the host |
| An admin `/system` route | A card on the workspace Dashboard, as the mock has it | The data is global and admin-only; the Dashboard is per workspace and belongs to another PR, which can reuse these pieces |
| Nothing when `/v1/system` fails | A second banner saying the status is unknown | Two banners about the same uncertainty, on every page, for a call nobody asked for |
| No banner on `/system` | Show it everywhere | It would sit directly above the same sentence |
| A minute between refreshes | 10 s; only on mount | Each call asks four providers for their models; a minute still catches a restart while someone reads a page |
| Three provider states | Ready / Down | "No key set" is a configuration choice, not a fault, and reads wrong as "Down" |

## Interfaces and contracts

- **HTTP API**: none changed. The UI reads `GET /v1/system` (admins only, always `200`).
- **Configuration**: none. The page *names* `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`
  and `LMSTUDIO_BASE_URL` in its advice, so renaming one means changing `src/system/status.ts`.
- **Data**: none.
- **Langflow**: none, beyond reporting where the API's key came from.
- **Events and logs**: none.

## Operations

Existing installs: `docker compose up -d --build web`. Nothing to migrate. The banner is the first
place an operator will see that LM Studio is not running; the fixes it prints are the same steps as
`docs/setup.md`, so they must change together.

## Testing

- `apps/admin/src/system/status.test.ts` (17 cases): nothing reported when the API says `ok`,
  including when a service is down but the API still calls itself healthy; the first failing service
  of several; a service the app has no advice for; the default chat and the default embedding model
  separately, each with the provider's own reason and its own fix; the fallback when the API is
  degraded for a reason this app cannot read; the labels for known and unknown names; and the
  detail lines for a service, a provider and the Langflow key.
- `apps/admin/e2e/system.spec.ts` (2 tests, real stack): the first opens `/system` from the admin
  nav and checks every service the API reported is listed, along with the Langflow key row, the
  version, the defaults and a provider with no key, then uses "Check again". The second asks the API
  whether it is degraded and checks the matching half of the contract: either the banner is above
  this page *and* above `/api-keys` with a link to the detail, or there is no banner and the page
  says everything answered.

By hand: stop LM Studio (or `docker compose stop chroma`) and check the banner names it with what to
do within a minute, on whatever page is open. As a non-admin, check there is no banner and that
`/system` says admins only.

## Out of scope and follow-ups

The workspace Dashboard's "Services" card from the mock, which is a separate screen and can reuse
`serviceLabel()`, `latencyNote()` and the state pill. Also not here: per-service history or uptime
(the API measures only now), an alert anywhere outside the admin UI, and the Whisper profile row the
mock shows, which `GET /ready` does not check.

## Docs updated

`README.md` (the System page and the banner in the admin UI) and `docs/api-schema.md` (the system
table now names the screen that reads the route).
