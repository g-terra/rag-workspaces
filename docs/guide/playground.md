# Playground and conversations

The playground is where you try a workspace the way an agent would use it through the API. It has three
modes, picked at the top of the page (the mode is in the URL, so a link opens the same one).

## Ask

One question, one answer written from the workspace's material. The answer streams in word by word, with
numbered citations like `[1]` that point to the passages it used. Each source shows its document and page
(or `at 12:34` for a recording) and opens the document there. Nothing is remembered between questions.

![Ask mode: a streamed answer with its sources](../images/playground-answer.png)

Under each answer, thumbs up or down records whether it helped, with an optional comment on a thumbs down.
Admins see that feedback in [Usage analytics](usage.md).

If no passage scores above the workspace's relevance threshold, the answer says the material doesn't cover
the question instead of guessing ([Workspaces](workspaces.md#settings-admins)).

Through the API: `POST /v1/workspaces/{slug}/answers { "question": "…" }`, or with
`Accept: text/event-stream` to stream it ([Using the API](../api.md#search-ask-and-chat-reader)).

## Search

Finds the passages closest to your words and shows each with its score (0 to 1). No model is called, so it
is fast, and it shows exactly what an answer would be given. Use it to see why an answer missed something:
if the right passage isn't here, no prompt change will fix it; look at chunk size, the embedding model or the
material itself ([Tuning](../tuning.md)).

![Search mode: passages and their scores](../images/playground-search.png)

Through the API: `GET /v1/workspaces/{slug}/passages?query=…`.

## Chat

A conversation: each reply sees the earlier turns (the last `CHAT_HISTORY_TURNS`, 10 by default), so
follow-ups like "why?" or "give an example" work. Each reply searches the material again and cites its own
sources.

![Chat mode: a conversation, each reply with its own sources](../images/playground-chat.png)

Through the API: `POST /v1/workspaces/{slug}/conversations`, then
`POST …/conversations/{id}/messages { "content": "…" }`.

> **Coming soon: response styles.** Choosing how answers are written, from four built-in styles (`academic`,
> `talkative`, `concise` and `tutor`), per question or as a workspace default, is in review ([#105](https://github.com/g-terra/rag-workspaces/pull/105)).

## Conversations

"Conversations" lists your chats with the workspace, newest first. Open one to read it in full, carry it
on, or delete it. Conversations are private: each person or API key sees only their own, and admins see
everyone's.

![A conversation opened from the list](../images/conversations.png)
