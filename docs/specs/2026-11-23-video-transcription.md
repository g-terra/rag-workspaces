---
title: transcribe video and audio with Whisper before ingestion
date: 2026-11-23
pr: pending
status: in review
areas: [api, db, flows, infra, docs]
---

# Transcribe video and audio with Whisper before ingestion

## Summary

With the optional `video` compose profile, MP4, MP3 and WAV uploads are transcribed by a Whisper service.
The timed transcript is saved next to the file, and the ingest flow reads that transcript instead of the
media. Each passage carries `start_seconds` and `end_seconds` in Chroma.

`GET /v1/workspaces/{slug}/documents/{id}/transcript` returns the transcript. Without the profile, media
uploads get `415`. This is M5 part 1. Part 2 brings the start times out through passages and citations.

## Why

docs/work-breakdown.md M5 (item 12) and decision "Video: faster-whisper ASR container, compose profile
`video`" (docs/decisions.md, supporting choices). Guilherme has lecture recordings as MP4 and asked for the
video part on 2026-11-23.

## Design

1. **Types.**
   - `detectType` (`apps/api/src/services/storage.ts`) recognises media by its header: `ftyp` at offset 4
     is `mp4` (also M4A and MOV), `RIFF…WAVE` is `wav`, and `ID3` or an MPEG frame sync is `mp3`. A bare
     frame sync only counts when the name says `.mp3`.
   - Migration `0008_media_types.sql` adds the three types to `document_type`.
2. **Whisper.**
   - Compose service `whisper` (`onerahmet/openai-whisper-asr-webservice:v1.10.0`) under profile `video`,
     with `ASR_ENGINE=faster_whisper`, `ASR_MODEL=${WHISPER_MODEL:-base}`, and models cached in the
     `whisper-models` volume.
   - `services/whisper.ts` (`WhisperClient`) streams the file (`openAsBlob`) to
     `POST /asr?task=transcribe&output=json&encode=true`. It keeps each segment's `start`, `end` and `text`,
     rounded to 0.1 s, and fails on an empty result ("No speech was found in this file.").
   - ffmpeg runs inside the service, so the API needs none.
3. **Ingestion** (`services/ingest.ts`).
   - A media document is claimed as `transcribing`. The transcript is written to `<file>.transcript.json`
     (`UploadStorage.writeTranscript`), then the claim moves to `processing` and the flow runs with the
     Loader's `file_path` set to the transcript.
   - A transcript already on disk is reused, because Whisper is the slow part. That covers retries and
     reindexes.
   - The run gets the same size-scaled timeout as the flow run. Failures follow the existing retry rules,
     from either status.
4. **Loader** (`document_loader.py`, and its copy embedded in `flows/ingest.json`).
   - `*.transcript.json` becomes rows of consecutive segments, at most 600 characters or 60 s each, with
     `start_seconds` and `end_seconds`.
   - The Upsert component already copies scalar metadata into Chroma.
5. **Drift check.** A flow runs the component code saved in its JSON, not the `.py` file.
   `apps/api/src/flows.test.ts` now fails when the two differ.
6. **API.**
   - `WHISPER_URL` (unset = off). With it unset, media uploads get `415` naming the profile.
   - New route `GET …/documents/{id}/transcript`. Downloads use `video/mp4`, `audio/mpeg` and `audio/wav`.
   - Deleting a document deletes its transcript.
7. **Smoke.** The stand-in model server answers `POST /asr` with two fixed segments, and the smoke compose
   points `WHISPER_URL` at it. A new step uploads a WAV and checks the transcript route, `start_seconds` in
   Chroma and search.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Whisper called by the API, transcript fed to the existing ingest flow | Transcribe inside a Langflow component | Decision 18: flows don't call out to services beyond models and Chroma, and a Langflow run would hold a long transcription; the AI part that matters (chunking, embedding) stays in the flow |
| Keep the transcript as a file next to the upload | A table | The ingest flow reads files from the uploads volume already; reindex and retry reuse it; backups of the volume keep it |
| Rows of ≤ 600 chars / 60 s | One row per Whisper segment | Segments are a few seconds each; tiny rows make poor passages. 600 is below the default chunk size, so most chunks keep their own start time |
| `onerahmet/openai-whisper-asr-webservice:v1.10.0` with faster-whisper | The newer v1.11.0, or the OpenAI engine | v1.11.0 was a day old. faster-whisper is quicker on CPU at the same accuracy |
| Off unless `COMPOSE_PROFILES=video` and `WHISPER_URL` are set | On by default | About 1 GB of image plus the model, and most installs don't need it |
| `415` for media without the profile | Accept it and fail later | The person learns at once what to turn on |

## Interfaces and contracts

- **HTTP API**:
  - `Document.type` gains `mp4`, `mp3` and `wav`.
  - New route `GET /v1/workspaces/{slug}/documents/{documentId}/transcript` returns
    `{ language: string | null, segments: [{ start, end, text }] }` (the `Transcript` schema in
    `packages/shared`). It answers `404` for other types and until the file is transcribed.
  - A media upload without the profile gets `415`.
- **Configuration**: `WHISPER_URL` (API), `COMPOSE_PROFILES=video`, `WHISPER_MODEL` (default `base`). All
  are in `.env.example`.
- **Data**:
  - Migration `0008_media_types.sql` adds enum values; it can't be undone without recreating the type.
  - Transcripts are written to `<slug>/<id>.<ext>.transcript.json` on the uploads volume.
- **Langflow**:
  - The `rw-ingest` Loader also reads `*.transcript.json`. Its rows have `start_seconds` and `end_seconds`,
    and so do the vectors in Chroma.
  - The `Loader` node's code in `flows/ingest.json` changed.
- **Events and logs**: documents emit `transcribing` over SSE. The log line `transcribed` records segments
  and milliseconds.

## Operations

To turn video on, set `COMPOSE_PROFILES=video` and `WHISPER_URL=http://whisper:9000` in `.env`, then run
`docker compose up -d --build`. The migration runs on API start. Langflow re-imports the flows on start, so
restart it (`up -d` does).

## Testing

- `services/storage.test.ts`: header detection for the three media types, and refusals.
- `services/ingest.test.ts`:
  - A video goes `transcribing`, `processing`, `ready`, with the transcript saved and passed to the Loader.
  - A saved transcript is reused.
  - A Whisper error, silence, and a missing Whisper each go back to `queued` with the reason.
- `routes/documents.test.ts`: `415` without the profile; with it, upload, the transcript route, the
  download type, and delete removing the transcript.
- `flows.test.ts`: the embedded component code matches the `.py` files. It failed until `ingest.json` was
  updated.
- The loader's grouping was checked by hand in Python: 30 five-second segments become rows starting at 0,
  60 and 120 s.
- `pnpm smoke` passed with the new WAV step, through the stand-in.
- The real Whisper image could not run here, because this sandbox can't download the model from Hugging
  Face. Its JSON output shape was checked in the image's source (`app/utils.py`, `WriteJSON`). A run on a
  real machine with one of the owner's MP4 lectures is still to do.

## Out of scope and follow-ups

- `startSeconds` on passages and citations, and the admin UI for media (M5 part 2 and its UI PR).
- GPU images and a configurable language (`language` query parameter).

## Docs updated

- `docs/setup.md`: "Video and audio".
- `docs/api-schema.md`: types and the transcript route.
- `docs/architecture.md`: status table, statuses and the profile command.
- `README.md`: status and formats.
- `.env.example`: the Whisper settings.
