"""Lazy orchestrator exports.

Importing ``orchestrators.agency`` must not pull in the RAG/embedding or cloud
upload stacks. The test environment includes ChromaDB but not the embedding
model; the optional orchestrators are imported on first access.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .agency import AgencyOrchestrator
    from .cloud_upload import CloudUploadOrchestrator
    from .rag import RAGOrchestrator
    from .wiki import WikiOrchestrator

__all__ = [
    "AgencyOrchestrator",
    "WikiOrchestrator",
    "RAGOrchestrator",
    "CloudUploadOrchestrator",
]

_EXPORTS = {
    "AgencyOrchestrator": "agency",
    "WikiOrchestrator": "wiki",
    "RAGOrchestrator": "rag",
    "CloudUploadOrchestrator": "cloud_upload",
}


def __getattr__(name: str):
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = __import__(f"{__name__}.{_EXPORTS[name]}", fromlist=[name])
    value = getattr(module, name)
    globals()[name] = value
    return value
