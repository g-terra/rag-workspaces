---
title: Video and audio transcription in the setup wizard
date: 2026-11-23
pr: "#76"
status: in review
areas: [infra, docs]
---

# Video and audio transcription in the setup wizard

## Summary

`pnpm run setup` now asks whether to transcribe video and audio uploads with Whisper. It explains the cost
first: an image of about 1 GB, the model download, and CPU time per hour of recording. If the answer is
yes, it asks for the model size, with each size's download and memory, and sets `COMPOSE_PROFILES`,
`WHISPER_URL` and `WHISPER_MODEL` in `.env`. Starting the stack then downloads the model, because the
whisper service loads it at startup and `docker compose up --wait` waits for the service to be healthy.
So the first upload doesn't stall on the download.

## Why

Guilherme asked for Whisper to be part of the setup. The video and audio support
([2026-11-23-video-transcription.md](2026-11-23-video-transcription.md)) was turned on by uncommenting
two lines in `.env`, which the wizard is meant to spare people
([docs/work-breakdown.md](../work-breakdown.md), workstream item 14).

## Design

- `scripts/setup/choices.ts`:
  - `whisperModelOptions()` lists `tiny`, `base`, `small`, `medium` and `large-v3`, each with its
    download size and rough memory.
  - `transcriptionEnv(on, model, profiles)` returns the `.env` values. On: the `video` profile is
    added to `COMPOSE_PROFILES` (other profiles are kept), `WHISPER_URL=http://whisper:9000`, and
    `WHISPER_MODEL`. Off: `video` is removed and `WHISPER_URL` is emptied. `WHISPER_MODEL` is kept, so
    turning it back on offers the same size.
- `scripts/setup/env-file.ts`: `setEnv` uncomments a key that is only present commented out
  (`# COMPOSE_PROFILES=video`, as `.env.example` ships it) instead of appending a second copy at the end.
  A live line still wins over a commented one.
- `scripts/setup.ts`: `chooseTranscription()` runs after the models. It shows a note on the cost, asks
  yes or no (defaulting to the current state, from `WHISPER_URL`), then asks for the model. Its changes
  are written with the model changes. With `--yes` it asks nothing and changes nothing. The start step
  names the Whisper model in its message when transcription is on.
- Pre-downloading needs no extra step. The whisper image (v1.10.0) calls `load_model()` when
  `app/webservice.py` is imported, which downloads the model into the `whisper-models` volume. The
  healthcheck answers only after that, and the wizard already runs
  `docker compose up --wait --wait-timeout 900`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Rely on `up --wait` and the healthcheck to download the model | A separate `docker compose run whisper` step that downloads, then exits | The service already downloads at startup and is only healthy after, so a second step would download through the same code and add nothing. |
| Default to off on a fresh install | Default to on | It costs about 1 GB of image plus the model and CPU time, and many installs only hold documents. The question explains this, so saying yes is one keypress. |
| Keep `WHISPER_MODEL` when turning it off | Clear it | The size is a preference, not a switch; keeping it makes the next "yes" offer the same size. |
| Uncomment keys in place in `setEnv` | Append `COMPOSE_PROFILES` and `WHISPER_URL` at the end and leave the commented copies | One line per key, next to its explanation in `.env`, is what a person reading the file expects. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: The wizard writes `COMPOSE_PROFILES`, `WHISPER_URL` and `WHISPER_MODEL`. These are
  the same variables `.env.example` documents, with the same meanings.
- **Data**: None. The model goes into the existing `whisper-models` volume.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Run `pnpm run setup` again on an existing install to turn transcription on or off. It recreates the `api`
service with the new `WHISPER_URL` and starts or leaves out `whisper`. Turning it off doesn't remove a
running whisper container: `docker compose --profile video stop whisper` does that. The model volume
stays until `docker volume rm` removes it.

The healthcheck allows about 10 minutes (a 300 s start period plus 30 retries of 10 s). On a slow
connection `large-v3` (3 GB) may need longer. The wizard then reports that `docker compose up` failed,
and running it again continues the download.

## Testing

- `scripts/setup/choices.test.ts`: the model options with their costs, and `transcriptionEnv` turning
  it on (other profiles kept, no duplicate `video`) and off (only `video` and the URL removed).
- `scripts/setup/env-file.test.ts`: a commented-out key is uncommented in place, and a live line wins
  over a commented one.
- By hand: the wizard was driven in a terminal, answering yes and picking `small`. `.env` ended up with
  `COMPOSE_PROFILES=video`, `WHISPER_URL=http://whisper:9000` and `WHISPER_MODEL=small`. The model
  download on `up` wasn't run here, because Hugging Face is blocked in this sandbox.

## Out of scope and follow-ups

- A GPU image for Whisper. CPU only, as before.
- A wizard bug noticed while testing, not fixed here: when no models can be listed, pressing Enter on the
  model id prompt to take the shown default fails with "A model id is required.", because the validation
  sees the empty input before the default is applied.

## Docs updated

`docs/setup.md` (what the wizard asks, and the "Video and audio" section).
