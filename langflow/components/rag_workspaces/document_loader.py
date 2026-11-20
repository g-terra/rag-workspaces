"""Load one workspace document (PDF, DOCX, MD, TXT) into page-level rows.

Each row carries the metadata the rest of the pipeline needs: document_id,
filename, folder and, for PDFs, the 1-based page number.
"""

from pathlib import Path

from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output, StrInput
from lfx.schema.data import Data
from lfx.schema.dataframe import DataFrame


class WorkspaceDocumentLoader(Component):
    display_name = "Workspace Document Loader"
    description = "Load a PDF, DOCX, MD or TXT file into page rows with document metadata."
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
