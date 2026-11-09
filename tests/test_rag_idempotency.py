"""Offline RAG storage tests for issue #17.

Regression coverage for the idempotency bug: Chroma ``add()`` silently skips
existing IDs, so a rerun left stale documents, metadata, and embeddings in
place. These tests use a real temporary Chroma store and fake embeddings, so
they need neither the network nor a sentence-transformers model.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

# chromadb is a dev dependency; skip cleanly in a core-only environment.
pytest.importorskip("chromadb", exc_type=ImportError)

from models.rag import Document, DocumentMetadata  # noqa: E402
from processors.rag.embedding import (  # noqa: E402
    TextEmbeddingPipeline,
    build_document_id,
)

EMBED_DIM = 16


def _fake_embeddings(count: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.random((count, EMBED_DIM), dtype="float32")


def _make_documents(
    texts: list[str], estate: str = "Test Estate", section: str = "History"
) -> list[Document]:
    return [
        Document(
            id=build_document_id(estate, section, i),
            text=text,
            metadata=DocumentMetadata(
                estate_name=estate,
                section_title=section,
                chunk_index=i,
                total_chunks=len(texts),
                source="wiki",
            ),
        )
        for i, text in enumerate(texts)
    ]


@pytest.fixture()
def pipeline(tmp_path) -> TextEmbeddingPipeline:
    """A pipeline with a throwaway Chroma store and no embedding model."""
    return TextEmbeddingPipeline(init_model=False, chroma_dir=tmp_path / "chroma")


def test_document_ids_are_deterministic_and_collision_free():
    assert build_document_id("Estate", "History", 0) == build_document_id(
        "Estate", "History", 0
    )

    ids = {
        build_document_id("Estate", "History", 0),
        build_document_id("Estate", "History", 1),
        build_document_id("Estate", "Transport", 0),
        build_document_id("Other Estate", "History", 0),
        # The old underscore-joined scheme collapsed these into one ID.
        build_document_id("A_1", "B", 0),
        build_document_id("A", "1_B", 0),
    }
    assert len(ids) == 6


def test_rerun_with_unchanged_input_keeps_a_stable_count(pipeline):
    documents = _make_documents(["alpha", "beta"])

    pipeline.store_documents(documents, _fake_embeddings(len(documents), seed=1))
    first_ids = pipeline.stored_ids()

    pipeline.store_documents(documents, _fake_embeddings(len(documents), seed=1))

    assert pipeline.stored_ids() == first_ids
    assert pipeline.collection.count() == 2


def test_rerun_with_changed_text_updates_document_metadata_and_embedding(pipeline):
    original = _make_documents(["old text"])[0]
    pipeline.store_documents(
        [original], np.array([[1.0] * EMBED_DIM], dtype="float32")
    )

    updated = original.model_copy(deep=True)
    updated.text = "new text"
    updated.metadata.total_chunks = 7
    new_embedding = np.array([[2.0] * EMBED_DIM], dtype="float32")
    pipeline.store_documents([updated], new_embedding)

    stored = pipeline.collection.get(
        ids=[original.id], include=["documents", "metadatas", "embeddings"]
    )
    assert stored["documents"] == ["new text"]
    assert stored["metadatas"][0]["total_chunks"] == 7
    assert np.allclose(np.asarray(stored["embeddings"])[0], new_embedding[0], atol=1e-5)
    assert pipeline.collection.count() == 1


def test_prune_removes_chunks_that_no_longer_exist(pipeline):
    documents = _make_documents(["a", "b", "c"])
    pipeline.store_documents(documents, _fake_embeddings(len(documents)))

    removed = pipeline.prune_documents({documents[0].id})

    assert removed == 2
    assert pipeline.stored_ids() == {documents[0].id}
    assert pipeline.collection.count() == 1


def test_store_documents_rejects_mismatched_embeddings(pipeline):
    documents = _make_documents(["a", "b"])
    with pytest.raises(ValueError):
        pipeline.store_documents(documents, _fake_embeddings(1))


def test_process_wiki_files_prunes_chunks_from_removed_sections(
    pipeline, tmp_path, monkeypatch
):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    pipeline.data_dir = wiki_dir
    monkeypatch.setattr(
        pipeline, "generate_embeddings", lambda texts: _fake_embeddings(len(texts))
    )

    source = {
        "Estate One": {
            "title": "Estate One",
            "sections": [
                {"title": "History", "text": "short history"},
                {"title": "Transport", "text": "short transport"},
            ],
        }
    }
    partition = wiki_dir / "wiki_data_partition_1.json"
    partition.write_text(json.dumps(source), encoding="utf-8")

    pipeline.process_wiki_files(batch_size=10)
    assert pipeline.collection.count() == 2
    removed_id = build_document_id("Estate One", "Transport", 0)
    assert removed_id in pipeline.stored_ids()

    # Drop the Transport section and rerun: its chunk must be pruned.
    source["Estate One"]["sections"] = [source["Estate One"]["sections"][0]]
    partition.write_text(json.dumps(source), encoding="utf-8")

    pipeline.process_wiki_files(batch_size=10)

    assert removed_id not in pipeline.stored_ids()
    assert pipeline.stored_ids() == {build_document_id("Estate One", "History", 0)}


def test_failed_file_prevents_prune(pipeline, tmp_path, monkeypatch):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    pipeline.data_dir = wiki_dir
    monkeypatch.setattr(
        pipeline, "generate_embeddings", lambda texts: _fake_embeddings(len(texts))
    )

    source = {
        "Estate One": {
            "title": "Estate One",
            "sections": [
                {"title": "History", "text": "short history"},
                {"title": "Transport", "text": "short transport"},
            ],
        }
    }
    (wiki_dir / "wiki_data_partition_1.json").write_text(
        json.dumps(source), encoding="utf-8"
    )
    pipeline.process_wiki_files(batch_size=10)

    stale_id = build_document_id("Estate One", "Transport", 0)
    assert stale_id in pipeline.stored_ids()

    # Remove a section but leave an unreadable file behind. Pruning would
    # delete chunks belonging to the unreadable file, so it must be skipped.
    source["Estate One"]["sections"] = [source["Estate One"]["sections"][0]]
    (wiki_dir / "wiki_data_partition_1.json").write_text(
        json.dumps(source), encoding="utf-8"
    )
    (wiki_dir / "wiki_data_partition_2.json").write_text(
        "{not valid json", encoding="utf-8"
    )

    pipeline.process_wiki_files(batch_size=10)

    assert stale_id in pipeline.stored_ids()


def test_empty_input_does_not_prune(pipeline, tmp_path):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    pipeline.data_dir = wiki_dir

    documents = _make_documents(["a"])
    pipeline.store_documents(documents, _fake_embeddings(len(documents)))

    pipeline.process_wiki_files(batch_size=10)

    assert pipeline.collection.count() == 1
