---
title: Keep focus on the page after deleting a conversation
date: 2026-11-23
pr: pending
status: proposed
areas: [admin]
---

# Keep focus on the page after deleting a conversation

## Summary

After you delete a conversation on `/w/:slug/conversations`, keyboard focus now moves to the page's
"Conversations" heading, and after you back out of the delete dialog (Cancel, Escape or the close button)
it returns to the Delete button. Before, focus fell to `<body>` in both cases, so a keyboard or screen
reader user had to start again from the top of the page.

## Why

The conversations screen (`2026-11-23-admin-conversations.md`, #64) first copied the documents page, which
moves focus to the list after a delete (`apps/admin/src/routes/documents.tsx`, `focusList` in
`onCloseAutoFocus`). The review fixes pushed to #64 from Google Antigravity rewrote the delete flow so the
deleted conversation no longer flashes a 404 error pane, and dropped that handling along the way. The
codebase review (`2026-11-23-retire-handover.md`) found it.

The dialog is opened from state, not through a Radix `DialogTrigger`, so Radix doesn't know its opener
and returns focus to nothing when it closes. `create-workspace-dialog.tsx` already works around this with
a `returnFocusTo` ref; this does the same.

## Design

All in `apps/admin/src/routes/conversations.tsx`:

1. The page's `<h1>` gets a ref and `tabIndex={-1}` (focusable from script, not in the tab order). The
   page passes `focusAfterDelete`, which focuses it, down through `Thread` to `DeleteDialog`.
2. `Thread` keeps a ref to its Delete button and passes it to `DeleteDialog` as `returnFocusTo`.
3. On a successful delete, `DeleteDialog` sets a `deleted` ref, closes, and calls `onDeleted`, which clears
   `?c=` with `{ replace: true }` as before. That order keeps Antigravity's fix: the deleted conversation's
   detail query is never refetched.
4. `DialogContent`'s `onCloseAutoFocus` always calls `preventDefault()`, then focuses the heading if
   `deleted` is set and the Delete button otherwise. Radix runs this after the focus trap and the page's
   `aria-hidden` are removed, so the new focus is neither pulled back into the dialog nor hidden from a
   screen reader. Moving focus earlier, in the mutation's `onSuccess`, would run while the trap is still
   active.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Focus the page heading after a delete | Focus the first remaining conversation, or the list | After deleting the last conversation the list is empty. The heading always exists, and the documents page falls back to its heading too |
| Move focus in `onCloseAutoFocus` | Focus in the mutation's `onSuccess` | `onSuccess` runs while the dialog is still open, so the focus trap can pull focus back to a dialog button (it only fails to when that button is disabled) and the page is still `aria-hidden` |
| A ref set in `onSuccess` says whether the close followed a delete | Read `remove.isSuccess` | The dialog may close before React re-renders with the mutation's new state; the ref is set before the dialog is told to close |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

- `apps/admin/e2e/conversations.spec.ts`: Escape out of the delete dialog leaves the Delete button
  focused; after the delete, the "Conversations" heading is focused. CI's e2e workflow runs it on the smoke
  stack (`pnpm e2e conversations.spec.ts` locally).
- By hand: open a conversation, Tab to Delete and press Enter, press Escape (focus is back on Delete), press
  Enter again, Tab to the dialog's Delete and press Enter. Focus lands on the heading.

## Out of scope and follow-ups

- The documents page's delete dialog has the same gap when it is cancelled: it is opened from state, so
  focus returns to nothing. It can take the same `returnFocusTo` treatment in its own PR.

## Docs updated

None needed: no long-lived doc describes focus handling.
