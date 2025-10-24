import json
from typing import List, Dict, Any
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import numpy as np
from logger import housing_logger
from config import housing_datahub_config
from ..base import BaseProcessor
from models.rag import Document, DocumentMetadata, SearchResult


class TextEmbeddingPipeline(BaseProcessor):
    """
    A lightweight text embedding pipeline for RAG text retrieval.
    Converts wiki text data to embeddings and stores in ChromaDB.
    Optimized for CPU usage on VPS deployment.
    """

    def __init__(self):
        super().__init__()
        self.model = None
        self.chroma_client = None
        self.collection = None

        # Initialize components
        self._init_embedding_model()
        self._init_chroma_db()

    def _set_file_paths(self):
        """Override base class to set RAG-specific file paths."""
        super()._set_file_paths()

        # Set RAG-specific paths
        self.data_dir = self.data_storage_path / "wiki"
        self.chroma_dir = self.data_storage_path / "chroma_db"
        self.chroma_dir.mkdir(parents=True, exist_ok=True)

    def _init_embedding_model(self):
        """Initialize lightweight embedding model optimized for CPU."""
        try:
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

        title = estate_data.get("title", estate_name)
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
                doc_id = f"{estate_name}_{section_title}_{i}".replace(" ", "_")

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

    def store_documents(self, documents: List[Document], embeddings: np.ndarray):
        """Store documents and their embeddings in ChromaDB."""
        try:
            ids = [doc.id for doc in documents]
            texts = [doc.text for doc in documents]
            metadatas = [doc.metadata.model_dump() for doc in documents]

            self.collection.add(
                embeddings=embeddings.tolist(),
                documents=texts,
                metadatas=metadatas,
                ids=ids,
            )

            housing_logger.info(f"Stored {len(documents)} documents in ChromaDB")

        except Exception as e:
            housing_logger.error(f"Failed to store documents: {e}")
            raise

    def _get_wiki_files(self) -> List[str]:
        """Get list of wiki data files to process."""
        root_path = housing_datahub_config.storage.wiki.files.get(
            "pages", "wiki_data_partition_{num}.json"
        ).format(num="*")
        wiki_files = list(self.data_dir.glob(root_path))
        return wiki_files

    def _process_single_file(self, file_path) -> List[Document]:
        """Process a single wiki data file and return all documents."""
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
            return []

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
        """Process all wiki data files and create embeddings."""
        # Use config batch size if not provided
        if batch_size is None:
            batch_size = housing_datahub_config.storage.rag.settings.get(
                "batch_size", 100
            )

        wiki_files = self._get_wiki_files()

        if not wiki_files:
            housing_logger.warning("No wiki data files found")
            return

        housing_logger.info(f"Found {len(wiki_files)} wiki data files")

        total_processed = 0

        for file_path in wiki_files:
            documents = self._process_single_file(file_path)
            if documents:
                batch_processed = self._process_documents_in_batches(documents, batch_size)
                total_processed += batch_processed

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
