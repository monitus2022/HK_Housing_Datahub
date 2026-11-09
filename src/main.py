from pathlib import Path

from logger import housing_logger
from orchestrators import (
    AgencyOrchestrator,  # noqa: F401 - enabled by uncommenting the pipeline block
    WikiOrchestrator,  # noqa: F401 - enabled by uncommenting the pipeline block
    RAGOrchestrator,
    CloudUploadOrchestrator,  # noqa: F401 - enabled by uncommenting the upload block
)
from quality.run import main as run_quality_checks


def main():
    # # Run data pipelines
    # agency_orchestrator = AgencyOrchestrator(
    #     debug_mode=False,
    #     keep_latest_transaction_only=False,
    # )
    # agency_orchestrator.run_estates_info_data_pipeline()
    # wiki_orchestrator = WikiOrchestrator()
    # wiki_orchestrator.run_estate_wiki_data_pipeline()

    # Run data quality checks (read-only). Report-only here so local runs are
    # not blocked by known source-data issues; use scripts/run_quality.py
    # --fail-on critical to gate.
    project_root = Path(__file__).resolve().parent.parent
    quality_db_path = project_root / "data" / "agency" / "agency_data.db"
    if quality_db_path.exists():
        run_quality_checks(
            [
                "--db",
                str(quality_db_path),
                "--output-dir",
                str(project_root / "data" / "quality"),
                "--fail-on",
                "none",
            ]
        )
    else:
        housing_logger.warning(
            f"Quality checks skipped; {quality_db_path} not found."
        )

    # Run RAG embedding pipeline
    rag_orchestrator = RAGOrchestrator()
    rag_orchestrator.run_text_embedding_pipeline()

    # Upload data to Cloudflare R2
    # cloud_upload_orchestrator = CloudUploadOrchestrator()
    # cloud_upload_orchestrator.upload_files_from_data_folder()


if __name__ == "__main__":
    main()
