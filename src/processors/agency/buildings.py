from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import sessionmaker
from .agency_base import AgencyProcessor
from models.agency.responses import (
    BuildingInfoResponse,
)
from models.agency.outputs import (
    SingleLanguageBaseModel,
    BilingualBaseModel,
    FacilitiesTableModel,
    TransactionsDetailModel,
    UnitFacilitiesModel,
    UnitInfoModel,
)
from models.agency.sql_db import Base



class BuildingsProcessor(AgencyProcessor):
    def __init__(self):
        super().__init__()
        self.zh_table_configs: dict[str, tuple[type[SingleLanguageBaseModel], type]] = {
            "units_cache": (UnitInfoModel, None),
            "unit_facilitiles_cache": (UnitFacilitiesModel, None),
            "transactions_cache": (TransactionsDetailModel, None),
        }
        self.table_configs: dict[str, tuple[type[BilingualBaseModel], type]] = {
            "facilities_cache": (FacilitiesTableModel, None),
        }

    def _set_data_caches(self):
        for cache_name in self.zh_table_configs.keys():
            self.caches[cache_name] = []
        for cache_name in self.table_configs.keys():
            self.caches[cache_name] = []
    
    def _create_tables(self):
        Base.metadata.create_all(self.engine)

    def process_building_info_response(self, building_info_response: BuildingInfoResponse) -> None:
        pass