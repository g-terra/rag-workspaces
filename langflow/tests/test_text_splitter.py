import pytest

from lfx.schema.data import Data
from lfx.schema.dataframe import DataFrame
from rag_workspaces.text_splitter import WorkspaceTextSplitter


def split(rows, chunk_size=200, chunk_overlap=0) -> list[dict]:
    splitter = WorkspaceTextSplitter(data_inputs=rows, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    return splitter.split_text().to_dict(orient="records")


def test_a_list_that_fits_stays_in_one_chunk_with_its_lead_in():
    text = (
        "Background paragraph that fills most of the first chunk on its own, more or less.\n\n"
        "The four steps are:\n1. Load the file\n2. Split it\n3. Embed the chunks\n4. Store them"
    )

    chunks = [c["text"] for c in split([Data(data={"text": text})], chunk_size=100)]

    assert chunks == [
        "Background paragraph that fills most of the first chunk on its own, more or less.",
        "The four steps are:\n1. Load the file\n2. Split it\n3. Embed the chunks\n4. Store them",
    ]


def test_cuts_at_sentence_ends_before_spaces_and_keeps_the_punctuation():
    text = "Retrieval finds passages. Generation writes the answer from them. Citations point back."

    chunks = [c["text"] for c in split([Data(data={"text": text})], chunk_size=50)]

    assert chunks == ["Retrieval finds passages.", "Generation writes the answer from them.", "Citations point back."]


def test_every_chunk_keeps_its_rows_metadata_and_rows_split_on_their_own():
    rows = DataFrame([
        Data(data={"document_id": "d", "page": 1, "text": "Page one sentence. " * 6}),
        Data(data={"document_id": "d", "page": 2, "text": "Short."}),
        Data(data={"document_id": "v", "start_seconds": 63.5, "end_seconds": 80.0, "text": "Spoken words."}),
    ])

    chunks = split(rows, chunk_size=60)

    pages = [(c.get("page"), c["text"]) for c in chunks if c["document_id"] == "d"]
    assert len([p for p, _ in pages if p == 1]) >= 2
    assert pages[-1] == (2, "Short.")  # page 2 is not merged into page 1's last chunk
    video = [c for c in chunks if c["document_id"] == "v"]
    assert [(c["start_seconds"], c["end_seconds"], c["text"]) for c in video] == [(63.5, 80.0, "Spoken words.")]


def test_overlap_repeats_the_end_of_one_chunk_at_the_start_of_the_next():
    text = " ".join(f"w{i:02d}" for i in range(30))  # 30 words of 3 characters

    chunks = [c["text"] for c in split([Data(data={"text": text})], chunk_size=40, chunk_overlap=12)]

    assert len(chunks) > 1
    for first, second in zip(chunks, chunks[1:]):
        assert first.split()[-1] in second.split()[:3]


def test_a_single_data_row_and_plain_dicts_are_accepted():
    assert split(Data(data={"text": "One.", "page": 4})) == [{"page": 4, "text": "One."}]
    assert split([{"text": "Two."}]) == [{"text": "Two."}]


def test_no_text_is_an_error():
    with pytest.raises(ValueError, match="No text to split"):
        split([Data(data={"text": "   "}), Data(data={"page": 1})])
