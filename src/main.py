from orchestrators import AgencyOrchestrator, WikiOrchestrator, RAGOrchestrator, CloudUploadOrchestrator

def main():
    # agency_orchestrator = AgencyOrchestrator(
    #     debug_mode=False,
    #     keep_latest_transaction_only=False,
    #     )
    # agency_orchestrator.run_estates_info_data_pipeline()
    # wiki_orchestrator = WikiOrchestrator()
    # wiki_orchestrator.run_estate_wiki_data_pipeline()

    # # Run RAG embedding pipeline
    # rag_orchestrator = RAGOrchestrator()
    # rag_orchestrator.run_text_embedding_pipeline()

    # Upload data to Cloudflare R2
    cloud_upload_orchestrator = CloudUploadOrchestrator()
    cloud_upload_orchestrator.upload_files_from_data_folder()

if __name__ == "__main__":
    main()