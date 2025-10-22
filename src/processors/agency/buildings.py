from typing import Optional
from logger import housing_logger
from time import time

from .agency_base import AgencyProcessor
from models.agency.responses import (
    BuildingInfoResponse,
    IdNameOnlyField,
)
from models.agency.responses import (
    TransactionsDetailField,
    UnitInfoField,
)
from models.agency.outputs import (
    SingleLanguageBaseModel,
    UnitFeaturesModel,
    TransactionsDetailModel,
    UnitFeaturesModel,
    UnitInfoModel,
)
from models.agency.sql_db import Base, Transactions, Unit, UnitFeature


class BuildingsProcessor(AgencyProcessor):
    def __init__(self, keep_latest_transaction_only: bool = False):
        super().__init__()
        self.keep_latest_transaction_only = keep_latest_transaction_only
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
        self._create_data_cache()
        # Create tables if not exist
        self._create_tables()

    def _create_data_cache(self):
        for cache_name in self.zh_table_configs.keys():
            self.caches[cache_name] = []
        for cache_name in self.table_configs.keys():
            self.caches[cache_name] = []

    def _create_tables(self):
        Base.metadata.create_all(self.engine)

    def map_building_info_response_to_table_dicts(
        self, building_info_response: BuildingInfoResponse
    ) -> None:
        building_id = building_info_response.building.id
        if not building_id:
            housing_logger.error(
                "Building ID is missing in the building info response."
            )
            return
        for unit_info in building_info_response.data:
            if not unit_info.unit_id:
                continue

            # Get unit transactions
            unit_features_data = self._map_transactions_to_table_dicts(
                transactions=unit_info.transactions,
                unit_id=unit_info.unit_id,
            )
            # Get unit info
            self._map_unit_info_to_table_dicts(
                building_id=building_id,
                unit_info=unit_info,
                unit_features_data=unit_features_data,
            )
            # Get unit features
            if unit_features_data.features:
                self._map_unit_features_to_table_dicts(
                    unit_id=unit_info.unit_id,
                    unit_features=unit_features_data.features,
                )

    def _map_transactions_to_table_dicts(
        self,
        transactions: list[TransactionsDetailField],
        unit_id: str,
    ) -> "UnitFeaturesFromTransactions":
        """
        Map transaction to TransactionsDetailModel
        If keep_latest_transaction_only is True, only keep the latest transaction per unit
        """
        unit_features, bedroom, sitting_room = None, None, None
        if self.keep_latest_transaction_only:
            # Sort transactions by tx_date descending and take the first (latest)
            sorted_transactions = sorted(transactions, key=lambda t: t.tx_date, reverse=True)
            transactions = [sorted_transactions[0]] if sorted_transactions else transactions

        for transaction in transactions:
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
            parsed_transaction = TransactionsDetailModel.from_response(
                unit_id=unit_id, response=transaction
            )
            self.caches["transactions_cache"].append(parsed_transaction.model_dump())
        return UnitFeaturesFromTransactions(
            features=unit_features, bedroom=bedroom, sitting_room=sitting_room
        )

    def _map_unit_info_to_table_dicts(
        self,
        building_id: str,
        unit_info: UnitInfoField,
        unit_features_data: "UnitFeaturesFromTransactions",
    ) -> None:
        """
        Map unit info to UnitInfoModel
        """
        unit_info_model = UnitInfoModel.from_response(
            response=unit_info,
            building_id=building_id,
            bedroom=unit_features_data.bedroom,
            sitting_room=unit_features_data.sitting_room,
        ).model_dump()
        if unit_info_model and unit_info_model not in self.caches["units_cache"]:
            self.caches["units_cache"].append(unit_info_model)

    def _map_unit_features_to_table_dicts(
        self,
        unit_id: str,
        unit_features: Optional[list[IdNameOnlyField]],
    ) -> None:
        """
        Map unit features to UnitFeaturesModel
        """
        for feature in unit_features:
            # Unit Features: IDs are english names
            feature_dict = UnitFeaturesModel.from_response(
                unit_id=unit_id, response=feature
            ).model_dump()
            if feature_dict not in self.caches["unit_features_cache"]:
                self.caches["unit_features_cache"].append(feature_dict)


class UnitFeaturesFromTransactions(SingleLanguageBaseModel):
    """
    Unit features parsed from transactions, not for table insertion
    """

    features: Optional[list[IdNameOnlyField]]
    bedroom: Optional[int]
    sitting_room: Optional[int]
