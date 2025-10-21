from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import sessionmaker

from .agency_base import AgencyProcessor
from models.agency.responses import (
    BuildingInfoResponse,
)
from models.agency.outputs import (
    SingleLanguageBaseModel,
    UnitFeaturesModel,
    TransactionsDetailModel,
    UnitFeaturesModel,
    UnitInfoModel,
)
from models.agency.sql_db import Base, Transactions, Unit, UnitFeature
from logger import housing_logger


class BuildingsProcessor(AgencyProcessor):
    def __init__(self):
        super().__init__()
        self.zh_table_configs: dict[str, tuple[type[SingleLanguageBaseModel], type]] = {
            "units_cache": (UnitInfoModel, Unit),
            "unit_features_cache": (UnitFeaturesModel, UnitFeature),
            "transactions_cache": (TransactionsDetailModel, Transactions),
        }
        self.table_configs = {}
        self.pk_map = {
            "units_cache": ["unit_id"],
            "unit_features_cache": ["feature_id"],
            "transactions_cache": ["tx_id"],
        }
        self._set_data_caches()
        # Create tables if not exist
        self._create_tables()

    def _set_data_caches(self):
        for cache_name in self.zh_table_configs.keys():
            self.caches[cache_name] = []
        for cache_name in self.table_configs.keys():
            self.caches[cache_name] = []

    def _create_tables(self):
        Base.metadata.create_all(self.engine)

    def map_building_info_response_to_table_dicts(
        self, building_info_response: BuildingInfoResponse
    ) -> None:
        for unit_info in building_info_response.data:
            if not unit_info.unit_id:
                continue
            unit_features = []
            bedroom, sitting_room = None, None

            for transaction in unit_info.transactions:
                # Get unit transactions
                if not transaction.id:
                    continue
                self.caches["transactions_cache"].append(
                    TransactionsDetailModel.from_response(
                        unit_id=unit_info.unit_id, response=transaction
                    ).model_dump()
                )
                # Get unit features from transactions info
                # Keep overwriting bedroom and sitting_room if multiple transactions exist, in case renovation
                unit_features = transaction.feature
                bedroom = (
                    transaction.bedroom if transaction.bedroom is not None else bedroom
                )
                sitting_room = (
                    transaction.sitting_room
                    if transaction.sitting_room is not None
                    else sitting_room
                )

            # Get unit info
            unit_info_model = UnitInfoModel(
                unit_id=unit_info.unit_id,
                floor=unit_info.floor,
                flat=unit_info.flat,
                area=unit_info.area,
                net_area=unit_info.net_area,
                bedroom=bedroom,
                sitting_room=sitting_room,
                building_id=building_info_response.building.id,
            ).model_dump()
            if unit_info_model and unit_info_model not in self.caches["units_cache"]:
                self.caches["units_cache"].append(unit_info_model)

            # Get unit features
            if not unit_features:
                continue
            for feature in unit_features:
                if not feature.id:
                    continue
                # Unit Features: IDs are english names
                feature_dict = UnitFeaturesModel(
                    unit_id=unit_info.unit_id,
                    feature_id=feature.id,
                    feature_name_zh=feature.name,
                    feature_name_en=feature.id
                ).model_dump()
                if feature_dict not in self.caches["unit_features_cache"]:
                    self.caches["unit_features_cache"].append(feature_dict)

