import json
from pathlib import Path

import docx
import pytest
from pypdf import PageObject
from pypdf.errors import LimitReachedError

from rag_workspaces.document_loader import WorkspaceDocumentLoader, transcript_rows


def pdf_with_pages(*pages: str) -> bytes:
    """A minimal PDF with one line of Helvetica text per page ("" makes a page with no text)."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for text in pages:
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode() if text else b""
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream.decode()}\nendstream")
        content = len(objects)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> "
            f"/Contents {content} 0 R >>"
        )
        kids.append(f"{len(objects)} 0 R")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def load(tmp_path: Path, name: str, **inputs):
    loader = WorkspaceDocumentLoader(file_path=name, document_id="doc-1", base_dir=str(tmp_path), **inputs)
    return loader.load_pages().to_dict(orient="records")


def test_pdf_rows_carry_their_page_number_and_skip_empty_pages(tmp_path):
    (tmp_path / "notes.pdf").write_bytes(pdf_with_pages("First page", "", "Third page"))

    rows = load(tmp_path, "notes.pdf")

    assert [(r["page"], r["text"]) for r in rows] == [(1, "First page"), (3, "Third page")]
    assert all(r["document_id"] == "doc-1" and r["filename"] == "notes.pdf" for r in rows)


def test_docx_is_one_row_of_its_non_empty_paragraphs(tmp_path):
    document = docx.Document()
    for text in ["Intro", "   ", "1. First item", "2. Second item"]:
        document.add_paragraph(text)
    document.save(tmp_path / "brief.docx")

    rows = load(tmp_path, "brief.docx")

    assert len(rows) == 1
    assert rows[0]["text"] == "Intro\n1. First item\n2. Second item"
    assert "page" not in rows[0]


def test_docx_without_text_is_refused(tmp_path):
    docx.Document().save(tmp_path / "empty.docx")

    with pytest.raises(ValueError, match="No text could be extracted from empty.docx"):
        load(tmp_path, "empty.docx")


@pytest.mark.parametrize("name", ["tips.md", "tips.markdown", "tips.txt"])
def test_text_files_load_whole_with_display_name_and_folder(tmp_path, name):
    (tmp_path / name).write_text("# Tips\n\nUse tweaks.", encoding="utf-8")

    rows = load(tmp_path, name, filename="Langflow tips", folder="week-1")

    assert rows == [{"document_id": "doc-1", "filename": "Langflow tips", "folder": "week-1",
                     "text": "# Tips\n\nUse tweaks."}]


def test_transcript_rows_keep_start_and_end_seconds(tmp_path):
    transcript = {"segments": [
        {"start": 0.0, "end": 4.5, "text": " Hello and welcome."},
        {"start": 4.5, "end": 9.0, "text": " Today: retrieval."},
        {"start": 70.0, "end": 75.0, "text": " After a minute."},
    ]}
    (tmp_path / "lecture.mp4.transcript.json").write_text(json.dumps(transcript), encoding="utf-8")

    rows = load(tmp_path, "lecture.mp4.transcript.json")

    assert [(r["start_seconds"], r["end_seconds"], r["text"]) for r in rows] == [
        (0.0, 9.0, "Hello and welcome. Today: retrieval."),
        (70.0, 75.0, "After a minute."),
    ]


def test_transcript_rows_end_at_the_character_limit():
    segments = [{"start": float(i), "end": float(i) + 1, "text": "x" * 250} for i in range(5)]

    rows = transcript_rows({"segments": segments}, {"document_id": "d"})

    # 250 + 250 (+ a space) fits in 600; a third would not.
    assert [(r.data["start_seconds"], r.data["end_seconds"]) for r in rows] == [(0.0, 2.0), (2.0, 4.0), (4.0, 5.0)]


def test_transcript_skips_blank_segments_and_handles_none():
    assert transcript_rows({"segments": [{"start": 0, "end": 1, "text": "  "}]}, {}) == []
    assert transcript_rows({}, {}) == []


def test_paths_outside_the_base_dir_are_refused(tmp_path):
    base = tmp_path / "uploads"
    base.mkdir()
    (tmp_path / "secret.txt").write_text("no", encoding="utf-8")

    with pytest.raises(ValueError, match="is outside"):
        WorkspaceDocumentLoader(file_path="../secret.txt", document_id="d", base_dir=str(base)).load_pages()
    with pytest.raises(ValueError, match="is outside"):
        WorkspaceDocumentLoader(file_path=str(tmp_path / "secret.txt"), document_id="d",
                                base_dir=str(base)).load_pages()


def test_missing_and_unsupported_files(tmp_path):
    with pytest.raises(FileNotFoundError):
        load(tmp_path, "nope.pdf")
    (tmp_path / "image.png").write_bytes(b"\x89PNG")
    with pytest.raises(ValueError, match="Unsupported file type: .png"):
        load(tmp_path, "image.png")


def test_pdf_without_text_is_refused(tmp_path):
    (tmp_path / "scan.pdf").write_bytes(pdf_with_pages(""))

    with pytest.raises(ValueError, match="No text could be extracted from scan.pdf"):
        load(tmp_path, "scan.pdf")


def too_complex_on(*pages: str):
    """extract_text that gives up, as pypdf does past its parsing budget, on pages with this text."""
    real = PageObject.extract_text

    def extract_text(self, *args, **kwargs):
        text = real(self, *args, **kwargs)
        if text.strip() in pages:
            raise LimitReachedError("Reached maximum number of tokens per stream")
        return text

    return extract_text


def test_a_pdf_page_too_complex_to_read_is_skipped_and_reported(tmp_path, monkeypatch):
    monkeypatch.setattr(PageObject, "extract_text", too_complex_on("Diagram page"))
    (tmp_path / "slides.pdf").write_bytes(pdf_with_pages("Intro", "Diagram page", "Outro"))
    loader = WorkspaceDocumentLoader(file_path="slides.pdf", document_id="d", base_dir=str(tmp_path))

    rows = loader.load_pages().to_dict(orient="records")

    assert [r["page"] for r in rows] == [1, 3]
    assert loader.status == "2 page row(s) from slides.pdf; skipped pages too complex to read: 2"


def test_a_pdf_with_every_page_too_complex_names_them(tmp_path, monkeypatch):
    monkeypatch.setattr(PageObject, "extract_text", too_complex_on("A", "B"))
    (tmp_path / "slides.pdf").write_bytes(pdf_with_pages("A", "B"))

    with pytest.raises(ValueError, match=r"pages too complex to read: 1, 2\)"):
        load(tmp_path, "slides.pdf")
