"""Turn the Knowledge component's rows into the passages and prompt context the flows return.

Knowledge (Retrieve) gives rows of text columns with `_score` = -distance and has no minimum score.
"""

from lfx.custom.custom_component.component import Component
from lfx.io import FloatInput, HandleInput, Output
from lfx.schema.data import Data
from lfx.schema.dataframe import DataFrame
from lfx.schema.message import Message


def number(value) -> int | None:
    """Ingestion stores every column as text, and a table fills missing cells with NaN."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def text(value) -> str | None:
    return value if isinstance(value, str) else None


class KnowledgePassages(Component):
    display_name = "Knowledge Passages"
    description = "Shape Knowledge results as scored passages and as numbered prompt context."
    icon = "list-ordered"
    name = "KnowledgePassages"

    inputs = [
        HandleInput(name="rows", display_name="Rows", input_types=["Table", "DataFrame"], required=True),
        FloatInput(name="min_score", display_name="Min Score", value=0.0),
    ]
    # See flows/README.md rule 8 for group_outputs.
    outputs = [
        Output(display_name="Passages", name="passages", method="get_passages", group_outputs=True),
        Output(display_name="Context", name="context", method="get_context", group_outputs=True),
    ]

    def _passages(self) -> list[dict]:
        out = []
        for row in DataFrame(self.rows).to_dict(orient="records"):
            score = round(1 + row["_score"], 4)  # cosine distance back to similarity
            if score < self.min_score:
                continue
            index = number(row.get("chunk_index"))
            out.append({
                "rank": len(out) + 1,
                "id": f"{row['document_id']}:{index}",
                "text": row["content"],
                "score": score,
                "document_id": row["document_id"],
                "filename": text(row.get("filename")),
                "page": number(row.get("page")),
                "start_seconds": number(row.get("start_seconds")),
                "chunk_index": index,
            })
        return out

    def get_passages(self) -> Data:
        return Data(data={"passages": self._passages()})

    def get_context(self) -> Message:
        blocks = []
        for p in self._passages():
            where = p["filename"] or p["document_id"]
            if p["page"]:
                where += f", page {p['page']}"
            elif p["start_seconds"] is not None:
                where += f", at {clock(p['start_seconds'])}"
            blocks.append(f"[{p['rank']}] ({where})\n{p['text']}")
        return Message(text="\n\n".join(blocks) if blocks else "No relevant passages found.")


def clock(seconds: int) -> str:
    """12:34, or 1:02:03 past an hour: how a person reads a time in a recording."""
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
