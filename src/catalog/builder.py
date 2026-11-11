"""Build the data catalogue and dataset cards.

The catalogue combines curated metadata with live SQLite introspection, the
latest quality report, and (optionally) the serving manifest. It powers the
dashboard Catalogue view and the generated Markdown data cards.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import sqlite3
import yaml

DEFAULT_METADATA = Path(__file__).resolve().parents[2] / "metadata" / "catalog.yml"


def load_metadata(path: Path | str = DEFAULT_METADATA) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    if not isinstance(payload, dict) or not payload.get("datasets"):
        raise ValueError(f"Invalid catalogue metadata: {path}")
    return payload


def _table_names(connection: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def _columns(connection: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    columns = []
    for _cid, name, data_type, not_null, default, primary_key in rows:
        null_count = connection.execute(
            f'SELECT sum(CASE WHEN "{name}" IS NULL THEN 1 ELSE 0 END) '
            f'FROM "{table}"'
        ).fetchone()[0]
        columns.append(
            {
                "name": name,
                "type": data_type or None,
                "nullable": not bool(not_null),
                "primary_key": bool(primary_key),
                "default": default,
                "null_count": int(null_count or 0),
            }
        )
    return columns


def _foreign_keys(connection: sqlite3.Connection, table: str) -> list[dict[str, str]]:
    rows = connection.execute(f'PRAGMA foreign_key_list("{table}")').fetchall()
    return [
        {"column": row[3], "references_table": row[2], "references_column": row[4]}
        for row in rows
    ]


def _table_card(
    connection: sqlite3.Connection,
    table: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    row_count = connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
    return {
        "name": table,
        "description": metadata.get("description"),
        "grain": metadata.get("grain"),
        "caveats": metadata.get("caveats"),
        "row_count": int(row_count),
        "columns": _columns(connection, table),
        "foreign_keys": _foreign_keys(connection, table),
    }


def _load_optional_json(path: Optional[Path | str]) -> Optional[dict[str, Any]]:
    if not path:
        return None
    candidate = Path(path)
    if not candidate.is_file():
        return None
    import json

    return json.loads(candidate.read_text(encoding="utf-8"))


def build_catalog(
    db_path: Path | str,
    metadata_path: Path | str = DEFAULT_METADATA,
    quality_path: Optional[Path | str] = None,
    manifest_path: Optional[Path | str] = None,
    *,
    require_complete: bool = True,
    generated_at: Optional[str] = None,
) -> dict[str, Any]:
    database = Path(db_path)
    if not database.is_file():
        raise FileNotFoundError(f"Database not found: {database}")
    metadata = load_metadata(metadata_path)
    table_metadata = metadata.get("tables") or {}
    datasets = metadata.get("datasets") or []
    dataset_ids = {dataset["id"] for dataset in datasets}

    connection = sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True)
    try:
        actual_tables = _table_names(connection)
        unknown = [name for name in actual_tables if name not in table_metadata]
        if require_complete and unknown:
            raise ValueError(
                "Tables without catalogue metadata: " + ", ".join(unknown)
            )

        tables_by_dataset: dict[str, list[dict[str, Any]]] = {
            dataset_id: [] for dataset_id in dataset_ids
        }
        for name in actual_tables:
            entry = table_metadata.get(name)
            if entry is None:
                continue
            dataset_id = entry.get("dataset")
            if dataset_id not in dataset_ids:
                raise ValueError(
                    f"Table {name} references unknown dataset {dataset_id!r}"
                )
            tables_by_dataset[dataset_id].append(
                _table_card(connection, name, entry)
            )
    finally:
        connection.close()

    quality = _load_optional_json(quality_path)
    manifest = _load_optional_json(manifest_path)

    dataset_cards = []
    for dataset in datasets:
        tables = sorted(
            tables_by_dataset.get(dataset["id"], []),
            key=lambda table: table["name"],
        )
        dataset_cards.append(
            {
                **{
                    key: dataset.get(key)
                    for key in (
                        "id",
                        "name",
                        "layer",
                        "description",
                        "source",
                        "refresh",
                        "licence",
                        "owner",
                        "caveats",
                        "artifacts",
                    )
                },
                "owner": dataset.get("owner") or metadata.get("owner"),
                "table_count": len(tables),
                "row_count": sum(table["row_count"] for table in tables),
                "tables": tables,
            }
        )

    return {
        "version": metadata.get("version", 1),
        "generated_at": generated_at
        or datetime.now(timezone.utc).isoformat(),
        "database": {
            "name": database.name,
            "table_count": len(actual_tables),
            "row_count": sum(
                table["row_count"]
                for tables in tables_by_dataset.values()
                for table in tables
            ),
        },
        "quality": quality.get("summary") if quality else None,
        "manifest": (
            {
                "build_id": manifest.get("build_id"),
                "schema_version": manifest.get("schema_version"),
                "data_through": manifest.get("data_through"),
                "coverage": manifest.get("coverage"),
            }
            if manifest
            else None
        ),
        "datasets": dataset_cards,
    }


def render_markdown(catalog: dict[str, Any]) -> str:
    lines = [
        "# Data Catalogue",
        "",
        "Generated by `python scripts/build_catalog.py`. "
        "Do not edit by hand; update `metadata/catalog.yml` instead.",
        "",
        f"- Generated: {catalog['generated_at']}",
        f"- Database: `{catalog['database']['name']}` "
        f"({catalog['database']['table_count']} tables, "
        f"{catalog['database']['row_count']:,} rows)",
    ]
    quality = catalog.get("quality")
    if quality:
        lines.append(
            f"- Quality: `{quality.get('status')}` "
            f"({quality.get('critical_failures', 0)} critical, "
            f"{quality.get('warning_failures', 0)} warnings)"
        )
    manifest = catalog.get("manifest")
    if manifest:
        lines.append(
            f"- Snapshot: `{manifest.get('build_id')}` "
            f"(schema {manifest.get('schema_version')})"
        )

    for dataset in catalog["datasets"]:
        lines.extend(
            [
                "",
                f"## {dataset['name']} (`{dataset['layer']}`)",
                "",
                dataset.get("description") or "",
                "",
            ]
        )
        for key in ("source", "refresh", "licence", "owner"):
            if dataset.get(key):
                lines.append(f"- **{key.title()}:** {dataset[key]}")
        if dataset.get("caveats"):
            lines.append(f"- **Caveats:** {dataset['caveats']}")
        lines.append(
            f"- **Tables:** {dataset['table_count']} "
            f"({dataset['row_count']:,} rows)"
        )
        if dataset.get("artifacts"):
            lines.append(
                "- **Artifacts:** " + ", ".join(dataset["artifacts"])
            )

        for table in dataset["tables"]:
            lines.extend(
                [
                    "",
                    f"### `{table['name']}`",
                    "",
                    table.get("description") or "",
                    "",
                    f"- **Grain:** {table.get('grain') or '—'}",
                    f"- **Rows:** {table['row_count']:,}",
                ]
            )
            if table.get("caveats"):
                lines.append(f"- **Caveats:** {table['caveats']}")
            lines.extend(
                [
                    "",
                    "| Column | Type | Null | PK | Nulls |",
                    "|---|---|---|---|---:|",
                ]
            )
            for column in table["columns"]:
                lines.append(
                    f"| `{column['name']}` | {column['type'] or '—'} | "
                    f"{'yes' if column['nullable'] else 'no'} | "
                    f"{'yes' if column['primary_key'] else ''} | "
                    f"{column['null_count']:,} |"
                )
            if table["foreign_keys"]:
                lines.append("")
                lines.append(
                    "Foreign keys: "
                    + ", ".join(
                        f"`{fk['column']} → {fk['references_table']}.{fk['references_column']}`"
                        for fk in table["foreign_keys"]
                    )
                )
    return "\n".join(lines) + "\n"
