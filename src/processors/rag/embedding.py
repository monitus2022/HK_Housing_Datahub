import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Union

import chromadb
import numpy as np
from chromadb.config import Settings

from config import housing_datahub_config
from logger import housing_logger
from models.rag import Document, DocumentMetadata, SearchResult

from ..base import BaseProcessor

# Chunk IDs are a SHA-1 digest of this separator-joined identity. A unit
# separator cannot occur in estate or section names, so the encoding is
# injective and two different chunks can never share an ID.
_ID_SEPARATOR = "\x1f"

# Page size when enumerating stored IDs, and batch size for deletes.
_ID_PAGE_SIZE = 5_000
_DELETE_BATCH_SIZE = 1_000


def build_document_id(estate_name: str, section_title: str, chunk_index: int) -> str:
    """Return the deterministic, collision-free ID for a wiki chunk.

    The identity key is ``estate_name`` + ``section_title`` + ``chunk_index``.
    The chunk *text* is deliberately excluded: editing a chunk keeps its ID, so
    a rerun refreshes the stored document in place instead of appending a
    duplicate. Document IDs are stable across runs and machines.
    """
    identity = _ID_SEPARATOR.join((estate_name, section_title, str(chunk_index)))
    return hashlib.sha1(identity.encode("utf-8")).hexdigest()


class TextEmbeddingPipeline(BaseProcessor):
    """
    A lightweight text embedding pipeline for RAG text retrieval.
    Converts wiki text data to embeddings and stores in ChromaDB.
    Optimized for CPU usage on VPS deployment.
    """

    def __init__(
        self,
        init_model: bool = True,
        chroma_dir: Optional[Union[str, Path]] = None,
    ):
        """Create the pipeline.

        ``init_model`` and ``chroma_dir`` are overridable so tests can exercise
        storage without downloading an embedding model and without touching the
        shared ``data/chroma_db`` store. Production callers keep the defaults.
        """
        super().__init__()
        self.model = None
        self.chroma_client = None
        self.collection = None

        if chroma_dir is not None:
            self.chroma_dir = Path(chroma_dir)

        if init_model:
            self._init_embedding_model()
        self._init_chroma_db()

    def _set_file_paths(self):
        """Override base class to set RAG-specific file paths."""
        super()._set_file_paths()

        # Set RAG-specific paths. Directories are created lazily in
        # _init_chroma_db so importing or instantiating without a Chroma store
        # does not touch the filesystem.
        self.data_dir = self.data_storage_path / "wiki"
        self.chroma_dir = self.data_storage_path / "chroma_db"

    def _init_embedding_model(self):
        """Initialize lightweight embedding model optimized for CPU."""
        try:
            # Imported lazily: torch/sentence-transformers are optional runtime
            # extras and are not installed in the test/CI environment.
            from sentence_transformers import SentenceTransformer

            # Use model from config
            model_name = housing_datahub_config.storage.rag.files.get(
                "embeddings_model", "all-MiniLM-L6-v2"
            )
            housing_logger.info(f"Loading embedding model: {model_name}")
            self.model = SentenceTransformer(model_name, device="cpu")
            housing_logger.info("Embedding model loaded successfully")
        except Exception as e:
            housing_logger.error(f"Failed to load embedding model: {e}")
            raise

    def _init_chroma_db(self):
        """Initialize ChromaDB client and collection."""
        try:
            self.chroma_dir.mkdir(parents=True, exist_ok=True)

            # Use persistent client for local storage
            self.chroma_client = chromadb.PersistentClient(
                path=str(self.chroma_dir), settings=Settings(anonymized_telemetry=False)
            )

            # Create or get collection
            collection_name = "hk_housing_wiki"
            try:
                self.collection = self.chroma_client.get_collection(
                    name=collection_name
                )
                housing_logger.info(
                    f"Using existing ChromaDB collection: {collection_name}"
                )
            except ValueError:
                self.collection = self.chroma_client.create_collection(
                    name=collection_name
                )
                housing_logger.info(
                    f"Created new ChromaDB collection: {collection_name}"
                )

        except Exception as e:
            housing_logger.error(f"Failed to initialize ChromaDB: {e}")
            raise

    def preprocess_text(self, text: str) -> str:
        """Basic text preprocessing for Chinese text."""
        if not text:
            return ""

        # Remove excessive whitespace
        text = " ".join(text.split())

        # Basic cleaning - remove wiki markup artifacts
        text = text.replace("==", "").replace("===", "")

        return text.strip()

    def chunk_text(
        self, text: str, chunk_size: int = None, overlap: int = None
    ) -> List[str]:
        """Split text into chunks with overlap for better retrieval."""
        # Use config values if not provided
        if chunk_size is None:
            chunk_size = housing_datahub_config.storage.rag.settings.get(
                "chunk_size", 500
            )
        if overlap is None:
            overlap = housing_datahub_config.storage.rag.settings.get(
                "chunk_overlap", 50
            )

        if not text or len(text) <= chunk_size:
            return [text] if text else []

        chunks = []
        start = 0

        while start < len(text):
            end = start + chunk_size

            # If we're not at the end, try to break at sentence boundary
            if end < len(text):
                # Look for sentence endings within the last 100 chars
                sentence_endings = ["。", "！", "？", "；", "\n"]
                break_pos = end
                for i in range(max(start, end - 100), end):
                    if text[i] in sentence_endings:
                        break_pos = i + 1
                        break
                end = break_pos

            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)

            # Move start position with overlap
            start = end - overlap

            # Prevent infinite loop
            if start >= len(text):
                break

        return chunks

    def process_estate_data(
        self, estate_name: str, estate_data: Dict[str, Any]
    ) -> List[Document]:
        """Process a single estate's wiki data into documents for embedding."""
        documents = []

        sections = estate_data.get("sections", [])

        for section in sections:
            section_title = section.get("title", "")
            section_text = section.get("text", "")

            # Preprocess text
            cleaned_text = self.preprocess_text(section_text)

            if not cleaned_text:
                continue

            # Chunk the text
            chunks = self.chunk_text(cleaned_text)

            for i, chunk in enumerate(chunks):
                doc_id = build_document_id(estate_name, section_title, i)

                metadata = DocumentMetadata(
                    estate_name=estate_name,
                    section_title=section_title,
                    chunk_index=i,
                    total_chunks=len(chunks),
                    source="wiki",
                )

                document = Document(
                    id=doc_id,
                    text=chunk,
                    metadata=metadata,
                )
                documents.append(document)

        return documents

    def generate_embeddings(self, texts: List[str]) -> np.ndarray:
        """Generate embeddings for a list of texts."""
        try:
            embeddings = self.model.encode(
                texts, convert_to_numpy=True, normalize_embeddings=True
            )
            return embeddings
        except Exception as e:
            housing_logger.error(f"Failed to generate embeddings: {e}")
            raise

    def store_documents(
        self, documents: List[Document], embeddings: np.ndarray
    ) -> int:
        """Upsert documents and their embeddings into ChromaDB.

        Chroma's ``add`` logs a warning and *skips* IDs that already exist
        (Chroma 0.5.5), which silently leaves stale chunks after a rerun.
        ``upsert`` refreshes the stored document, metadata, and embedding in
        place instead. Returns the number of documents written.
        """
        if len(documents) != len(embeddings):
            raise ValueError(
                f"Expected {len(documents)} embeddings, got {len(embeddings)}"
            )
        if not documents:
            return 0

        try:
            ids = [doc.id for doc in documents]
            texts = [doc.text for doc in documents]
            metadatas = [doc.metadata.model_dump() for doc in documents]

            self.collection.upsert(
                embeddings=embeddings.tolist(),
                documents=texts,
                metadatas=metadatas,
                ids=ids,
            )

            housing_logger.info(f"Upserted {len(documents)} documents in ChromaDB")
            return len(documents)

        except Exception as e:
            housing_logger.error(f"Failed to store documents: {e}")
            raise

    def stored_ids(self) -> Set[str]:
        """Return every document ID currently in the collection."""
        ids: Set[str] = set()
        offset = 0
        while True:
            batch = self.collection.get(
                include=[], limit=_ID_PAGE_SIZE, offset=offset
            )
            batch_ids = batch.get("ids") or []
            if not batch_ids:
                break
            ids.update(batch_ids)
            if len(batch_ids) < _ID_PAGE_SIZE:
                break
            offset += len(batch_ids)
        return ids

    def prune_documents(self, expected_ids: Set[str]) -> int:
        """Delete stored chunks whose source text is gone.

        ``upsert`` refreshes chunks that still exist, but it cannot remove
        chunks that disappeared — for example a section edited down from three
        chunks to two, or an estate removed from the wiki dump. This deletes
        every stored ID that is not in ``expected_ids`` so the collection
        converges to exactly the current source.

        Only call this after a *complete* successful run. Pruning after a
        partial run would delete valid chunks from files that failed to load.
        """
        stale = [
            doc_id
            for doc_id in self.stored_ids()
            if doc_id not in expected_ids
        ]

        for start in range(0, len(stale), _DELETE_BATCH_SIZE):
            self.collection.delete(ids=stale[start : start + _DELETE_BATCH_SIZE])

        housing_logger.info(
            f"Pruned {len(stale)} stale chunks; {len(expected_ids)} expected"
        )
        return len(stale)

    def _get_wiki_files(self) -> List[str]:
        """Get list of wiki data files to process."""
        root_path = housing_datahub_config.storage.wiki.files.get(
            "pages", "wiki_data_partition_{num}.json"
        ).format(num="*")
        wiki_files = list(self.data_dir.glob(root_path))
        return wiki_files

    def _process_single_file(self, file_path) -> List[Document]:
        """Process a single wiki data file and return all documents.

        Errors propagate so the caller can skip pruning: pruning after a file
        failed to load would treat that file's chunks as deleted.
        """
        housing_logger.info(f"Processing {file_path.name}")

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            all_documents = []

            for estate_name, estate_data in data.items():
                documents = self.process_estate_data(estate_name, estate_data)
                all_documents.extend(documents)

            return all_documents

        except Exception as e:
            housing_logger.error(f"Failed to process {file_path.name}: {e}")
            raise

    def _process_documents_in_batches(self, all_documents: List[Document], batch_size: int) -> int:
        """Process documents in batches, generating embeddings and storing in ChromaDB."""
        total_processed = 0

        for i in range(0, len(all_documents), batch_size):
            batch = all_documents[i : i + batch_size]
            texts = [doc.text for doc in batch]

            # Generate embeddings
            embeddings = self.generate_embeddings(texts)

            # Store in ChromaDB
            self.store_documents(batch, embeddings)

            total_processed += len(batch)
            housing_logger.info(
                f"Processed batch {i//batch_size + 1}, total documents: {total_processed}"
            )

        return total_processed

    def process_wiki_files(self, batch_size: int = None):
        """Process all wiki data files, upserting chunks and pruning orphans."""
        # Use config batch size if not provided
        if batch_size is None:
            batch_size = housing_datahub_config.storage.rag.settings.get(
                "batch_size", 100
            )

        wiki_files = self._get_wiki_files()

        if not wiki_files:
            # Do not prune: an empty input directory is more likely a config
            # error than a deliberate "delete everything" signal.
            housing_logger.warning("No wiki data files found; skipping prune")
            return

        housing_logger.info(f"Found {len(wiki_files)} wiki data files")

        total_processed = 0
        expected_ids: Set[str] = set()
        failed_files: List[str] = []

        for file_path in wiki_files:
            try:
                documents = self._process_single_file(file_path)
            except Exception as e:
                housing_logger.error(f"Failed to process {file_path.name}: {e}")
                failed_files.append(file_path.name)
                continue

            if documents:
                batch_processed = self._process_documents_in_batches(
                    documents, batch_size
                )
                total_processed += batch_processed
                expected_ids.update(doc.id for doc in documents)

        if failed_files:
            housing_logger.warning(
                "Skipping orphan prune because "
                f"{len(failed_files)} file(s) failed: {', '.join(failed_files)}"
            )
        elif not expected_ids:
            # Valid JSON that produced no chunks usually means a schema drift
            # (for example the ``sections`` key was renamed). Pruning here
            # would wipe the collection, so require an explicit manual reset.
            housing_logger.warning(
                "No chunks produced from the wiki files; skipping prune. "
                "Delete data/chroma_db/ manually if the corpus is truly empty."
            )
        else:
            self.prune_documents(expected_ids)

        housing_logger.info(f"Completed processing. Total documents: {total_processed}")

    def search_similar(self, query: str, n_results: int = 5) -> SearchResult:
        """Search for similar documents using semantic similarity."""
        try:
            # Generate embedding for query
            query_embedding = self.generate_embeddings([query])[0]

            # Search in ChromaDB
            results = self.collection.query(
                query_embeddings=[query_embedding.tolist()],
                n_results=n_results,
                include=["documents", "metadatas", "distances"],
            )

            return SearchResult(**results)

        except Exception as e:
            housing_logger.error(f"Search failed: {e}")
            return SearchResult(documents=[], metadatas=[], distances=[])
