from orchestrators import AgencyOrchestrator


def main():
    agency_orchestrator = AgencyOrchestrator(debug_mode=True)
    agency_orchestrator.run_estates_info_data_pipeline()

if __name__ == "__main__":
    main()