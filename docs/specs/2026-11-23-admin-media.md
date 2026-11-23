---
title: Video and audio in the admin UI
date: 2026-11-23
pr: pending
status: in review
areas: [admin, docs]
---

# Video and audio in the admin UI

## Summary

The admin UI now handles recordings. "Upload" accepts MP4, MP3 and WAV. A ready recording's panel in
"Documents" shows its transcript, one line per Whisper segment with the time it starts. Sources in the
playground, and passages in search, say `at 12:34` for a recording, where a PDF says `page 12`. When the
API refuses a file (415), the upload row shows the API's reason, which says when video needs the
`video` profile.

## Why

Milestone M5 (`docs/work-breakdown.md`) ends with timestamped citations. The API already returns
transcripts ([2026-11-23-video-transcription.md](2026-11-23-video-transcription.md)) and start times
([2026-11-23-start-times.md](2026-11-23-start-times.md)). This PR makes both visible to people using the
admin UI.

## Design

- `apps/admin/src/documents/files.ts`: `ACCEPT` gains `.mp4,.mp3,.wav`. `isMedia()` names the
  transcribed types. `uploadErrorMessage` returns the API's `detail` for a 415 and falls back to the
  fixed text only when there is none.
- `apps/admin/src/playground/answer.ts`: `clock()` formats seconds as `m:ss` (or `h:mm:ss`), and
  `passageWhere()` prefers page, then start time, then passage number. The search panel and the passage
  dialog already use `passageWhere`.
- `apps/admin/src/playground/answer-view.tsx`: a source card shows `at m:ss` when the citation has no
  page but has a start time.
- `apps/admin/src/documents/queries.ts`: `useTranscript()` reads
  `GET /v1/workspaces/{slug}/documents/{id}/transcript`.
- `apps/admin/src/documents/transcript-view.tsx`: `TranscriptView` lists the segments.
  `DocumentTranscript` in `apps/admin/src/routes/documents.tsx` loads it for a media document once it is
  `ready`, under a "Transcript" heading with the detected language.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Show the transcript only once the document is `ready` | Also while it is `processing` (the transcript exists by then) | One rule that is always true. A failed or in-flight document may have no transcript yet, and asking would show a 404 as an error. |
| A 415 shows the API's reason | Keep the fixed "Not a supported file" text | The API knows why: wrong content, or video without the `video` profile. The fixed text can't tell those apart. |
| The UI accepts MP4, MP3 and WAV even when the server has no `video` profile | Ask `GET /v1/system` whether Whisper is configured, and hide them if not | Readers can't call `/v1/system` (admin only), and the API's 415 already explains what to turn on. |
| No media player, just times | Play the recording from the transcript or a citation | It needs a streaming route with range requests for 2 GB files. That is a follow-up if it's wanted. |

## Interfaces and contracts

- **HTTP API**: None. The UI uses the existing transcript route and `startSeconds`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Rebuild the `web` image (`docker compose up -d --build web`).

## Testing

- `apps/admin/src/documents/files.test.ts`: the new types are accepted, `isMedia` holds, and a 415 shows
  the API's reason, falling back to the fixed text.
- `apps/admin/src/playground/answer.test.ts`: `clock()` and `passageWhere()` with a start time.
- `apps/admin/src/documents/transcript-view.test.tsx`: segments are rendered with their times, and an
  empty transcript says so.
- `apps/admin/e2e/library.spec.ts`: a new test uploads a WAV to the smoke stack (stand-in Whisper),
  waits for Ready, and finds both segments with `0:03` in the panel's transcript.
- `apps/admin/e2e/upload.spec.ts`: the API-refused file now shows the API's reason.

## Out of scope and follow-ups

- Playing a recording from a time in the transcript or a citation (needs a range-request route).
- Clicking a transcript line to find its passage.

## Docs updated

`docs/setup.md` ("Video and audio": what the admin UI shows).
