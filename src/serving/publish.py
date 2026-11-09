"""Publish a serving snapshot to an S3-compatible bucket.

Versioned data files are uploaded first, then ``dashboard/{build_id}/manifest.json``,
then the short-cache ``dashboard/manifest.json`` pointer. The publisher never
logs credentials.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from config import cloud_storage_secrets, housing_datahub_config
from logger import housing_logger

from .snapshot import build_snapshot
from .verify import verify_snapshot

BUCKET_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
MANIFEST_CACHE_CONTROL = "public, max-age=60"
DATA_CACHE_CONTROL = "public, max-age=31536000, immutable"
Uploader = Callable[[Path, str, str, str, str | None], None]


def validate_bucket_name(bucket_name: str) -> str:
    if (
        not bucket_name
        or not BUCKET_PATTERN.match(bucket_name)
        or ".." in bucket_name
    ):
        raise ValueError(
            f"Invalid bucket name: {bucket_name!r}. Use 3-63 lowercase "
            "letters, numbers, dots, or hyphens."
        )
    return bucket_name


def cache_control_for(logical_name: str) -> str:
    return (
        MANIFEST_CACHE_CONTROL
        if logical_name == "manifest"
        else DATA_CACHE_CONTROL
    )


def content_type_for(path: Path) -> str:
    if path.name.endswith(".json.gz"):
        return "application/json"
    return {
        ".json": "application/json",
        ".parquet": "application/octet-stream",
        ".md": "text/markdown",
    }.get(path.suffix.lower(), "application/octet-stream")


def content_encoding_for(path: Path) -> str | None:
    return "gzip" if path.name.endswith(".gz") else None


def default_bucket(service_type: str) -> str:
    if service_type == "aws":
        return housing_datahub_config.aws.bucket_name
    if service_type == "cloudflare":
        return housing_datahub_config.cloudflare.bucket_name
    raise ValueError(f"Unsupported service type: {service_type}")


def load_manifest(snapshot_dir: Path) -> dict[str, Any]:
    manifest_path = snapshot_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _safe_snapshot_file(snapshot_dir: Path, relative_path: str) -> Path:
    path = Path(relative_path)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(
            f"Unsafe manifest file path: {relative_path!r}"
        )
    target = snapshot_dir / path
    if not target.exists():
        raise FileNotFoundError(f"Manifest file not found: {target}")
    if target.stat().st_size == 0:
        raise ValueError(f"Manifest file is empty: {target}")
    return target


def plan_uploads(snapshot_dir: Path) -> list[dict[str, Any]]:
    manifest = load_manifest(snapshot_dir)
    build_id = manifest["build_id"]
    uploads: list[dict[str, Any]] = []

    for logical_name, relative_path in manifest["files"].items():
        local_path = _safe_snapshot_file(snapshot_dir, relative_path)
        uploads.append(
            {
                "logical_name": logical_name,
                "local_path": local_path,
                "key": f"dashboard/{build_id}/{relative_path}",
                "content_type": content_type_for(local_path),
                "content_encoding": content_encoding_for(local_path),
                "cache_control": cache_control_for(logical_name),
            }
        )

    versioned_manifest = snapshot_dir / "manifest.json"
    uploads.append(
        {
            "logical_name": "manifest",
            "local_path": versioned_manifest,
            "key": f"dashboard/{build_id}/manifest.json",
            "content_type": "application/json",
            "content_encoding": None,
            "cache_control": cache_control_for("manifest"),
        }
    )
    uploads.append(
        {
            "logical_name": "manifest-pointer",
            "local_path": versioned_manifest,
            "key": "dashboard/manifest.json",
            "content_type": "application/json",
            "content_encoding": None,
            "cache_control": cache_control_for("manifest"),
        }
    )
    return uploads


def _make_s3_client(service_type: str):
    import boto3

    cloud_storage_secrets.require_credentials(service_type=service_type)
    if service_type == "cloudflare":
        endpoint_url = housing_datahub_config.cloudflare.endpoint_url.format(
            account_id=cloud_storage_secrets.account_id
        )
        region = housing_datahub_config.cloudflare.region
    elif service_type == "aws":
        region = housing_datahub_config.aws.region
        endpoint_url = f"https://s3.{region}.amazonaws.com"
    else:
        raise ValueError(f"Unsupported service type: {service_type}")

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=cloud_storage_secrets.access_key_id,
        aws_secret_access_key=cloud_storage_secrets.secret_access_key,
        region_name=region,
    )


def publish_snapshot(
    snapshot_dir: Path | str,
    bucket_name: str,
    service_type: Optional[str] = None,
    dry_run: bool = False,
    uploader: Optional[Uploader] = None,
) -> list[dict[str, Any]]:
    """Upload a snapshot, or return the upload plan when ``dry_run``.

    ``uploader`` is injectable for tests: it receives
    ``(local_path, key, content_type, cache_control, content_encoding)``.
    """
    directory = Path(snapshot_dir)
    uploads = plan_uploads(directory)
    validate_bucket_name(bucket_name)

    if dry_run:
        for upload in uploads:
            encoding = upload["content_encoding"] or "identity"
            housing_logger.info(
                f"DRY RUN upload {upload['key']} "
                f"({upload['local_path'].stat().st_size} bytes, "
                f"{encoding}, {upload['cache_control']})"
            )
        return uploads

    active_uploader = uploader
    if active_uploader is None:
        service = service_type or housing_datahub_config.cloud_storage.service_type
        client = _make_s3_client(service)

        def s3_uploader(
            local_path: Path,
            key: str,
            content_type: str,
            cache_control: str,
            content_encoding: str | None,
        ) -> None:
            extra_args = {
                "ContentType": content_type,
                "CacheControl": cache_control,
            }
            if content_encoding:
                extra_args["ContentEncoding"] = content_encoding
            client.upload_file(
                str(local_path),
                bucket_name,
                key,
                ExtraArgs=extra_args,
            )

        active_uploader = s3_uploader

    for upload in uploads:
        housing_logger.info(f"Uploading {upload['key']}")
        active_uploader(
            upload["local_path"],
            upload["key"],
            upload["content_type"],
            upload["cache_control"],
            upload["content_encoding"],
        )

    return uploads


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build and publish the dashboard serving snapshot."
    )
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Raw agency SQLite database (marts must already be built).",
    )
    parser.add_argument(
        "--output-dir",
        default="data/serving",
        help="Root directory for versioned snapshots.",
    )
    parser.add_argument(
        "--build-id",
        default=None,
        help="Override the generated build ID.",
    )
    parser.add_argument(
        "--bucket",
        default=None,
        help="Override the configured bucket name.",
    )
    parser.add_argument(
        "--service-type",
        choices=["cloudflare", "aws"],
        default=None,
        help="Override the configured cloud service type.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Write the local snapshot and print the upload plan only.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        manifest = build_snapshot(
            args.db,
            output_root=args.output_dir,
            build_id=args.build_id,
        )
        snapshot_dir = Path(args.output_dir) / manifest["build_id"]
        errors = verify_snapshot(snapshot_dir)
        if errors:
            for error in errors:
                housing_logger.error(error)
            return 1

        service_type = (
            args.service_type
            or housing_datahub_config.cloud_storage.service_type
        )
        bucket_name = args.bucket or default_bucket(service_type)
        uploads = publish_snapshot(
            snapshot_dir,
            bucket_name,
            service_type=service_type,
            dry_run=args.dry_run,
        )
        if args.dry_run:
            housing_logger.info(
                f"Dry run complete: {len(uploads)} planned uploads for "
                f"{snapshot_dir}"
            )
        else:
            housing_logger.info(
                f"Published {len(uploads)} files from {snapshot_dir} "
                f"to bucket {bucket_name}"
            )
        return 0
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        housing_logger.error(str(exc))
        return 2
    except Exception as exc:
        housing_logger.error(f"Publish failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
