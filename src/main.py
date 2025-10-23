from orchestrators import AgencyOrchestrator, WikiOrchestrator
from pprint import pprint

def main():
    agency_orchestrator = AgencyOrchestrator(
        debug_mode=False,
        keep_latest_transaction_only=False,
        )
    agency_orchestrator.run_estates_info_data_pipeline()
    wiki_orchestrator = WikiOrchestrator()
    wiki_orchestrator.run_estate_wiki_data_pipeline()

if __name__ == "__main__":
    main()