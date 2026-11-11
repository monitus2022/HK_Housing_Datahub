"""Crawler for HKP district rental transactions.

The building transaction endpoint returns sales only. Rental (lease)
transactions live under the district transaction search with ``tx_type=L`` and
are limited to the last one or three years.
"""

from __future__ import annotations

import requests

from config import housing_datahub_config
from logger import housing_logger

from ..base import BaseCrawler

ALLOWED_SPANS = {"1year", "3year"}


class RentalsCrawler(BaseCrawler):
    def __init__(self, agency_session: requests.Session):
        super().__init__()
        self.session = agency_session
        self._set_request_urls()

    def _set_request_urls(self) -> None:
        self.transactions_url = (
            housing_datahub_config.agency_api.urls.transactions_search
        )

    def fetch_district_rentals(
        self,
        district_id: str,
        span: str = "3year",
        page_size: int = 1000,
    ) -> list[dict] | None:
        if span not in ALLOWED_SPANS:
            raise ValueError(
                f"Unsupported span {span!r}; use one of {sorted(ALLOWED_SPANS)}."
            )

        records: list[dict] = []
        page = 1
        while True:
            response = self._make_request(
                url=self.transactions_url,
                params={
                    "lang": "en",
                    "dist_ids": district_id,
                    "tx_date": span,
                    "page": page,
                    "limit": page_size,
                    "tx_type": "L",
                },
            )
            if response is None:
                housing_logger.error(
                    f"Rental fetch failed for district {district_id} "
                    f"page {page}."
                )
                return None
            try:
                payload = response.json()
            except ValueError as exc:
                housing_logger.error(
                    f"Rental response was not JSON for district {district_id}: {exc}"
                )
                return None
            page_records = payload.get("result") or []
            records.extend(page_records)
            total = int(payload.get("count") or 0)
            if len(page_records) < page_size or len(records) >= total:
                break
            page += 1

        housing_logger.info(
            f"Fetched {len(records)} rentals for district {district_id} "
            f"({span})."
        )
        return records
