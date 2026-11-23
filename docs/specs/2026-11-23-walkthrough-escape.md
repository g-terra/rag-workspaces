---
title: let Escape close a walkthrough started from Help right away
date: 2026-11-23
pr: "#125"
status: in review
areas: [admin]
---

# Let Escape close a walkthrough started from Help right away

## Summary

Help → **Show the walkthrough** now opens the walkthrough once the Help menu has finished closing, instead
of in the same click. Before, an Escape pressed in the first moments after the welcome appeared went to
the still-closing Help menu and the walkthrough stayed open. That made the last step of
`apps/admin/e2e/walkthrough.spec.ts` flaky in CI.

## Why

The "Escape also ends it" step of the walkthrough e2e test failed about 2 runs in 5 on PRs #111 and #114
(expected no dialog, found the welcome). It builds on `2026-11-23-first-time-walkthrough.md` (PR #107).

Root cause, reproduced 10 times out of 10 by pressing Escape on the first frame the welcome is there: Radix
only listens for Escape on the **top** dismiss layer. The Help menu's popover stays mounted, and on top,
for its close animation (`animate-out`, about 150 ms). The welcome dialog only becomes the top layer a few
renders after it is painted. Until then the closing menu took the Escape, called `preventDefault` and
"dismissed" itself again, so nothing closed the walkthrough.

## Design

`apps/admin/src/components/help-menu.tsx`: **Show the walkthrough** sets a ref and closes the menu. The
menu's `onCloseAutoFocus`, which Radix calls when the popover has unmounted after its animation, sees the
ref, calls `preventDefault` so focus doesn't go back to the Help button, and calls `start()`. The welcome
then appears with no other dismiss layer around, so the first Escape reaches it. Closing the menu any other
way (Escape, a click outside) leaves the ref unset and starts nothing.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Start the walkthrough after the menu has closed | Turn off the menu's close animation (`data-[state=closed]:animate-none` loses to `animate-out` in the CSS) | Fixes the cause without fighting the animation CSS; the 150 ms wait is the animation people already see |
| Fix the ordering, not the test | Wait in the test until the dialog is focused before pressing Escape | A person can press Escape that fast too; the test now presses it on the first frame on purpose |
| No extra Escape listener of our own on `window` | Close the walkthrough on any Escape Radix didn't handle | Tried: not needed once the menu is gone, and it would add a second way to close |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

- `apps/admin/e2e/walkthrough.spec.ts`: the Escape step now clicks **Show the walkthrough** and presses
  Escape inside the page on the first animation frame the welcome exists, then expects no dialog. Against
  the old Help menu that path left the welcome open 10 times out of 10 (in a Chromium run against the Vite
  dev server with a stubbed API); with this change, 0 out of 10. A normal-speed loop of
  Help → Show → Escape also passed 10 out of 10.
- By hand: Help → Show the walkthrough, press Escape immediately.

## Out of scope and follow-ups

None.

## Docs updated

None needed: the guide describes Help → Show the walkthrough, which behaves the same apart from the timing.
