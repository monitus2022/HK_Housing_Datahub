from config import housing_datahub_config
from logger import housing_logger
from processors.rag import TextEmbeddingPipeline


class RAGOrchestrator:
    """
    Orchestrator for the RAG text embedding pipeline.
    Handles the complete workflow from data ingestion to cloud upload.
    """

    def __init__(self):
        self.pipeline = TextEmbeddingPipeline()

    def run_text_embedding_pipeline(self):
        """
        Run the complete text embedding pipeline.
        """
        try:
            housing_logger.info("Starting RAG text embedding pipeline")

            # Run the embedding pipeline
            self.pipeline.process_wiki_files()

            housing_logger.info("RAG text embedding pipeline completed successfully")

        except Exception as e:
            housing_logger.error(f"RAG pipeline failed: {e}")
            raise
