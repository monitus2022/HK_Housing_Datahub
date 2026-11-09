from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import sessionmaker

from ..base import BaseProcessor
from config import housing_datahub_config
from logger import housing_logger
from models.agency.sql_db import Base, PipelineRun
import os
import json
from abc import abstractmethod


class AgencyProcessor(BaseProcessor):
    def __init__(self, db_path: Optional[Path | str] = None):
        super().__init__()
        self.db_path = Path(db_path) if db_path is not None else None
        self._set_agency_file_paths()
        self._init_sql_db()
        # Primary key map retained for test/reference; upserts derive keys from
        # the SQLAlchemy model itself.
        self.pk_map = {}

    @abstractmethod
    def _create_tables(self):
        pass

    @abstractmethod
    def _create_data_cache(self):
        pass

    def _set_agency_file_paths(self) -> None:
        self.agency_data_storage_path = (
            self.data_storage_path / housing_datahub_config.storage.agency.path
        )
        if not self.agency_data_storage_path.exists():
            try:
                self.agency_data_storage_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                housing_logger.error(
                    f"Failed to create directory {self.agency_data_storage_path}: {e}"
                )
        self.estate_ids_file_path = (
            self.agency_data_storage_path
            / housing_datahub_config.storage.agency.files.get(
                "estate_ids", "estate_ids.txt"
            )
        )

    def _init_sql_db(self) -> None:
        """
        Initialize SQL database connection and session.

        ``db_path`` is injectable so tests can use a temporary database and
        never touch the reference ``data/agency/agency_data.db`` file.
        """
        if self.db_path is not None:
            self.local_db_path = Path(self.db_path)
        else:
            self.local_db_path = (
                self.agency_data_storage_path
                / housing_datahub_config.storage.agency.files.get(
                    "sqlite_db", "agency_data.db"
                )
            )
        self.local_db_path.parent.mkdir(parents=True, exist_ok=True)
        self.remote_db_path = None  # To be set for remote DBs like Neon
        self.engine = create_engine(f"sqlite:///{self.local_db_path}")
        # Enable WAL mode for better concurrency
        with self.engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL;"))
            housing_logger.info("Enabled WAL journal mode for SQLite database.")
            conn.commit()
        Session = sessionmaker(bind=self.engine)
        self.session = Session()

    def export_data_caches_to_json(self) -> None:
        """
        Export data caches to JSON files for inspection
        """
        output_directory = self.agency_data_storage_path / "data_cache_exports"
        os.makedirs(output_directory, exist_ok=True)

        for cache_name, data_list in self.caches.items():
            output_file_path = os.path.join(output_directory, f"{cache_name}.json")
            with open(output_file_path, "w", encoding="utf-8") as f:
                json.dump(data_list, f, ensure_ascii=False, indent=4)
            housing_logger.info(f"Exported {cache_name} to {output_file_path}.")

    def _upsert_rows(self, db_table_class, rows: list[dict]) -> int:
        """Upsert rows for one table using the model's actual primary key.

        SQLite's ``ON CONFLICT DO UPDATE`` handles duplicate keys within the
        same batch too; the last value wins. Conflict targets come from the
        SQLAlchemy model, not the hand-maintained ``pk_map``.
        """
        if not rows:
            return 0

        table = db_table_class.__table__
        columns = [column.name for column in table.columns]
        column_set = set(columns)
        primary_keys = [column.name for column in table.primary_key.columns]
        if not primary_keys:
            raise ValueError(
                f"Table {table.name} has no primary key; cannot upsert safely."
            )

        for row in rows:
            unknown = set(row) - column_set
            if unknown:
                raise ValueError(
                    f"Unknown columns for {table.name}: {sorted(unknown)}"
                )

        key_sets = {frozenset(row) for row in rows}
        if len(key_sets) != 1:
            raise ValueError(
                f"All rows for {table.name} must have the same keys; "
                f"got {len(key_sets)} different key sets."
            )
        present_columns = key_sets.pop()
        missing_primary_keys = [
            name for name in primary_keys if name not in present_columns
        ]
        if missing_primary_keys:
            raise ValueError(
                f"Rows for {table.name} are missing primary keys: "
                f"{missing_primary_keys}"
            )

        required_columns = [
            column.name
            for column in table.columns
            if column.name not in primary_keys
            and not column.nullable
            and column.default is None
            and column.server_default is None
        ]
        missing_required = [
            name for name in required_columns if name not in present_columns
        ]
        if missing_required:
            raise ValueError(
                f"Rows for {table.name} are missing required columns: "
                f"{missing_required}"
            )

        cleaned_rows = [
            {key: row[key] for key in columns if key in row} for row in rows
        ]
        statement = sqlite_insert(table)
        # Only update columns that the caller actually supplied. This keeps a
        # partial upsert from nulling out existing values it did not mention.
        update_columns = {
            name: getattr(statement.excluded, name)
            for name in columns
            if name not in primary_keys and name in present_columns
        }
        if update_columns:
            statement = statement.on_conflict_do_update(
                index_elements=primary_keys, set_=update_columns
            )
        else:
            statement = statement.on_conflict_do_nothing(
                index_elements=primary_keys
            )

        # Keep each execution comfortably below SQLite's variable limit. With
        # executemany this is mostly a memory/transaction-size guard.
        chunk_size = max(1, 900 // max(1, len(columns)))
        for start in range(0, len(cleaned_rows), chunk_size):
            self.session.execute(
                statement, cleaned_rows[start : start + chunk_size]
            )
        return len(cleaned_rows)

    def upsert_cache_into_db_tables(
        self, config_maps: Optional[list[dict]] = None
    ) -> int:
        """
        Upsert cached data into database tables.

        Re-running the same batch leaves row counts unchanged and refreshes
        non-key columns.
        """
        housing_logger.info("Upserting cached data into database tables.")
        total_processed = 0

        for table_config in config_maps or []:
            for cache_name, (_, db_table_class) in table_config.items():
                data_list = self.caches.get(cache_name, [])
                if not data_list:
                    continue
                processed = self._upsert_rows(db_table_class, data_list)
                housing_logger.debug(
                    f"{processed} records upserted into {db_table_class.__tablename__}."
                )
                total_processed += processed
        self.session.commit()
        housing_logger.info(
            f"Upsert completed, {total_processed} records processed."
        )
        return total_processed

    def bulk_insert_cache_into_db_tables(
        self, config_maps: Optional[list[dict]] = None
    ) -> int:
        """Backward-compatible alias for the idempotent upsert path."""
        return self.upsert_cache_into_db_tables(config_maps=config_maps)

    def table_counts(self, tables: Optional[list[str]] = None) -> dict[str, int]:
        """Return row counts for the tables used in run metadata."""
        table_names = tables or [
            "estates",
            "buildings",
            "units",
            "unit_features",
            "transactions",
            "estate_monthly_market_info",
        ]
        counts: dict[str, int] = {}
        for table_name in table_names:
            try:
                counts[table_name] = self.session.execute(
                    text(f'SELECT count(*) FROM "{table_name}"')
                ).scalar_one()
            except Exception as exc:
                housing_logger.warning(
                    f"Could not count table {table_name}: {exc}"
                )
                counts[table_name] = -1
        return counts

    def start_pipeline_run(self, run_id: str, mode: str = "full") -> None:
        """Record the start of a pipeline run."""
        run = PipelineRun(
            run_id=run_id,
            started_at=datetime.now(timezone.utc).replace(tzinfo=None),
            mode=mode,
            status="running",
        )
        self.session.merge(run)
        self.session.commit()

    def finish_pipeline_run(
        self,
        run_id: str,
        status: str = "success",
        record_counts: Optional[dict] = None,
        error_message: Optional[str] = None,
    ) -> None:
        """Record the end state of a pipeline run."""
        run = self.session.get(PipelineRun, run_id)
        if run is None:
            housing_logger.warning(
                f"Pipeline run {run_id} was not found; cannot finalize it."
            )
            return
        run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        run.status = status
        run.record_counts_json = json.dumps(
            record_counts or {}, ensure_ascii=False, sort_keys=True
        )
        run.error_message = error_message
        self.session.commit()

    def close_session(self) -> None:
        """Close the database session"""
        if self.session:
            self.session.close()
            housing_logger.info("Database session closed.")

    def clean_local_db(self) -> None:
        """
        Clean the local SQLite database by dropping all tables and recreating them.
        """
        housing_logger.info("Cleaning local SQLite database.")
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        housing_logger.info("Local SQLite database cleaned and tables recreated.")
