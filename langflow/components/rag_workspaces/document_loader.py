"""Load one workspace document (PDF, DOCX, MD, TXT, or a video/audio transcript) into rows.

Each row carries the metadata the rest of the pipeline needs: document_id,
filename, folder and, for PDFs, the 1-based page number. A transcript
(`<file>.transcript.json`, written by the API from Whisper's output) becomes rows
of consecutive segments, each with `start_seconds` and `end_seconds`, so
passages can point to the moment they come from.
"""

import json
from pathlib import Path

from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output, StrInput
from lfx.schema.data import Data
from lfx.schema.dataframe import DataFrame

# A transcript row ends after this many characters or seconds, whichever comes first. Smaller than
# the usual chunk size, so most chunks keep the start time of the words they hold.
TRANSCRIPT_ROW_CHARS = 600
TRANSCRIPT_ROW_SECONDS = 60


class WorkspaceDocumentLoader(Component):
    display_name = "Workspace Document Loader"
    description = "Load a PDF, DOCX, MD or TXT file, or a transcript, into rows with document metadata."
    icon = "file-text"
    name = "WorkspaceDocumentLoader"

    inputs = [
        StrInput(name="file_path", display_name="File Path", info="Path on the uploads volume.", required=True),
        StrInput(name="document_id", display_name="Document ID", required=True),
        StrInput(name="filename", display_name="Filename", info="Display name; defaults to the file's name."),
        MessageTextInput(name="folder", display_name="Folder", info="Optional folder inside the workspace."),
        StrInput(name="base_dir", display_name="Base Dir", value="/data/uploads", advanced=True,
                 info="Relative file paths are resolved against this folder; paths outside it are rejected."),
    ]
    outputs = [Output(display_name="Pages", name="pages", method="load_pages")]

    def _resolve(self) -> Path:
        base = Path(self.base_dir).resolve()
        path = Path(self.file_path)
        path = (path if path.is_absolute() else base / path).resolve()
        if base != path and base not in path.parents:
            msg = f"{path} is outside {base}"
            raise ValueError(msg)
        if not path.is_file():
            msg = f"File not found: {path}"
            raise FileNotFoundError(msg)
        return path

    def load_pages(self) -> DataFrame:
        path = self._resolve()
        ext = path.suffix.lower()
        meta = {"document_id": self.document_id, "filename": self.filename or path.name}
        if self.folder:
            meta["folder"] = self.folder

        rows: list[Data] = []
        if ext == ".pdf":
            from pypdf import PdfReader

            for i, page in enumerate(PdfReader(str(path)).pages, start=1):
                text = (page.extract_text() or "").strip()
                if text:
                    rows.append(Data(data={**meta, "page": i, "text": text}))
        elif ext == ".docx":
            import docx

            doc = docx.Document(str(path))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            rows.append(Data(data={**meta, "text": text}))
        elif path.name.endswith(".transcript.json"):
            rows = transcript_rows(json.loads(path.read_text(encoding="utf-8")), meta)
        elif ext in {".md", ".markdown", ".txt"}:
            rows.append(Data(data={**meta, "text": path.read_text(encoding="utf-8", errors="replace")}))
        else:
            msg = f"Unsupported file type: {ext}"
            raise ValueError(msg)

        if not rows:
            msg = f"No text could be extracted from {path.name}"
            raise ValueError(msg)
        self.status = f"{len(rows)} page row(s) from {path.name}"
        return DataFrame(rows)


def transcript_rows(transcript: dict, meta: dict) -> list[Data]:
    """Group Whisper segments into rows of a few sentences, keeping when each row starts and ends."""
    rows: list[Data] = []
    texts: list[str] = []
    start = end = 0.0

    def flush():
        if texts:
            rows.append(Data(data={**meta, "start_seconds": start, "end_seconds": end, "text": " ".join(texts)}))

    for seg in transcript.get("segments", []):
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        if texts and (len(" ".join(texts)) + len(text) > TRANSCRIPT_ROW_CHARS or seg["start"] - start >= TRANSCRIPT_ROW_SECONDS):
            flush()
            texts = []
        if not texts:
            start = float(seg["start"])
        texts.append(text)
        end = float(seg["end"])
    flush()
    return rows
