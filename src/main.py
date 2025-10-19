from orchestrators import AgencyOrchestrator


def main():
    agency_orchestrator = AgencyOrchestrator()
    agency_orchestrator.run_estates_info_data_pipeline()
    print(agency_orchestrator.estates_processor.estate_ids_cache)

if __name__ == "__main__":
    main()