"""Split loaded rows into chunks at the text's own boundaries.

Langflow's Split Text cuts at one separator only. Set to a space, it cut chunks at any word, so a
numbered list or a definition was split across two chunks in the middle of an item. This splitter tries
paragraph breaks first, then line breaks, then sentence ends, then spaces, and only cuts inside a word
when nothing else fits, so a list that fits in a chunk stays in one chunk with the sentence before it.

Each input row (a PDF page, a transcript segment, a whole text file) is split on its own, and every chunk
keeps its row's metadata (page, start_seconds and the rest).
"""

from langchain_text_splitters import RecursiveCharacterTextSplitter

from lfx.custom.custom_component.component import Component
from lfx.io import HandleInput, IntInput, Output
from lfx.schema.data import Data
from lfx.schema.dataframe import DataFrame

# Biggest boundary first. ". " and the other sentence ends keep their punctuation with the sentence.
SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", " ", ""]


class WorkspaceTextSplitter(Component):
    display_name = "Workspace Text Splitter"
    description = "Split rows into chunks at paragraph, line and sentence boundaries, keeping each row's metadata."
    icon = "scissors-line-dashed"
    name = "WorkspaceTextSplitter"

    inputs = [
        HandleInput(
            name="data_inputs",
            display_name="Input",
            info="Rows with a text column, such as the document loader's pages.",
            input_types=["Table", "DataFrame", "Data", "JSON"],
            required=True,
        ),
        IntInput(name="chunk_size", display_name="Chunk Size", value=800, info="Maximum characters per chunk."),
        IntInput(name="chunk_overlap", display_name="Chunk Overlap", value=100,
                 info="Characters repeated from the end of one chunk at the start of the next."),
    ]
    outputs = [Output(display_name="Chunks", name="dataframe", method="split_text")]

    def _rows(self) -> list[dict]:
        rows = self.data_inputs
        if isinstance(rows, DataFrame):
            return rows.to_dict(orient="records")
        if isinstance(rows, Data):
            return [rows.data]
        return [r.data if isinstance(r, Data) else dict(r) for r in rows]

    def split_text(self) -> DataFrame:
        splitter = RecursiveCharacterTextSplitter(
            separators=SEPARATORS,
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            keep_separator="end",
        )
        chunks = []
        for row in self._rows():
            text = str(row.get("text") or "")
            meta = {k: v for k, v in row.items() if k != "text"}
            chunks.extend(Data(data={**meta, "text": piece.strip()}) for piece in splitter.split_text(text) if piece.strip())
        if not chunks:
            msg = "No text to split"
            raise ValueError(msg)
        for i, chunk in enumerate(chunks):
            chunk.data["chunk_index"] = i
        self.status = f"{len(chunks)} chunk(s)"
        return DataFrame(chunks)
