"""Processor for HKP rental transactions."""

from __future__ import annotations

from typing import Optional

from models.agency.outputs import RentalTransactionModel
from models.agency.sql_db import Base, RentalTransaction
from logger import housing_logger

from .agency_base import AgencyProcessor


class RentalsProcessor(AgencyProcessor):
    def __init__(self, db_path: Optional[str] = None):
        super().__init__(db_path=db_path)
        self.table_configs: dict[str, tuple[type, type]] = {
            "rentals_cache": (RentalTransactionModel, RentalTransaction),
        }
        self.pk_map = {"rentals_cache": ["rental_id"]}
        self._create_data_cache()
        self._create_tables()

    def _create_data_cache(self) -> None:
        self.caches = {"rentals_cache": []}

    def _create_tables(self) -> None:
        Base.metadata.create_all(self.engine)

    def map_rental_transactions(self, items: list[dict]) -> int:
        added = 0
        for item in items:
            try:
                model = RentalTransactionModel.from_api(item)
            except (KeyError, TypeError, ValueError) as exc:
                housing_logger.warning(
                    f"Skipping rental transaction {item.get('id')}: {exc}"
                )
                continue
            self.caches["rentals_cache"].append(model.model_dump())
            added += 1
        return added

    def flush(self) -> int:
        processed = self.upsert_cache_into_db_tables(
            config_maps=[self.table_configs]
        )
        self.clear_data_caches(cache_excluded=[])
        return processed
