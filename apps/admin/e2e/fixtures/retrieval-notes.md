# Retrieval notes

Retrieval-augmented generation answers a question in two steps. First it searches a collection of
passages for the ones closest to the question. Then it gives those passages to a language model, which
writes an answer that cites them.

## Chunking

Documents are split into passages of a few hundred characters with some overlap, so a sentence that
crosses a boundary still appears whole in one of them.
