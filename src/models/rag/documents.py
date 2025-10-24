from pydantic import BaseModel
from typing import Dict, Any, Optional


class DocumentMetadata(BaseModel):
    """Metadata for a document chunk."""
    estate_name: str
    section_title: str
    chunk_index: int
    total_chunks: int
    source: str = "wiki"


class Document(BaseModel):
    """Represents a document chunk for embedding."""
    id: str
    text: str
    metadata: DocumentMetadata


class SearchResult(BaseModel):
    """Result from a similarity search."""
    documents: list[list[str]]
    metadatas: list[list[Dict[str, Any]]]
    distances: list[list[float]]
    ids: Optional[list[list[str]]] = None