"""Generate the POC sample documents (run once; outputs are committed).

pip install reportlab python-docx && python3 scripts/make-samples.py
"""
from pathlib import Path

import docx
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

out = Path(__file__).resolve().parent.parent / "samples"
(out / "ouc").mkdir(parents=True, exist_ok=True)
(out / "personal").mkdir(parents=True, exist_ok=True)

pages = [
    "Week 1: Retrieval augmented generation. Retrieval augmented generation combines a retriever with a "
    "language model. The retriever finds passages in a vector database and the model answers using them.",
    "Week 2: Embeddings and chunking. Documents are split into overlapping chunks before embedding. "
    "Chunk size trades recall against precision; an overlap of ten to twenty percent is common.",
    "Week 3: Evaluation. Answers are evaluated for faithfulness to the retrieved passages and for relevance "
    "to the question. Citations with page numbers let a reader verify each claim.",
]
c = canvas.Canvas(str(out / "ouc" / "cos512-notes.pdf"), pagesize=A4)
for text in pages:
    t = c.beginText(50, 780)
    words, line = text.split(), ""
    for w in words:
        if len(line) + len(w) > 85:
            t.textLine(line)
            line = ""
        line += w + " "
    t.textLine(line)
    c.drawText(t)
    c.showPage()
c.save()

d = docx.Document()
d.add_heading("COS512 assignment brief", 1)
d.add_paragraph("Option 4 asks students to expose AI interactions through an API wrapping Langflow, "
                "with usage analytics, tests and setup documentation.")
d.add_paragraph("Deliverables are the source code including the Langflow flow JSON, a report of three to "
                "five pages and a demo video of three to five minutes.")
d.save(str(out / "ouc" / "assignment-brief.docx"))

(out / "ouc" / "langflow-tips.md").write_text(
    "# Langflow tips\n\nTweaks override component fields per request, so one flow can serve many workspaces.\n\n"
    "Streaming returns tokens as server-sent events when stream=true is passed to the run endpoint.\n")
(out / "personal" / "recipes.txt").write_text(
    "Sourdough bread needs a lively starter, flour, water and salt. Bake at 230 degrees with steam "
    "for the first twenty minutes.\nRetrieval of recipes should never leak into the ouc workspace.\n")
print("samples written to", out)
