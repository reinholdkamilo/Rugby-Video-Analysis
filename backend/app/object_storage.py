from __future__ import annotations

import hashlib
import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote

import boto3
from botocore.client import BaseClient
from botocore.config import Config

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "").strip()
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "").strip()
R2_ENDPOINT_URL = os.getenv("R2_ENDPOINT_URL", "").strip()
R2_PRESIGNED_URL_SECONDS = int(os.getenv("R2_PRESIGNED_URL_SECONDS", "3600"))
OBJECT_CACHE_DIR = Path(os.getenv("OBJECT_CACHE_DIR", "cache/object_storage"))


def is_object_storage_enabled() -> bool:
    return bool(
        R2_BUCKET_NAME
        and R2_ACCESS_KEY_ID
        and R2_SECRET_ACCESS_KEY
        and (R2_ENDPOINT_URL or R2_ACCOUNT_ID)
    )


def _endpoint_url() -> str:
    if R2_ENDPOINT_URL:
        return R2_ENDPOINT_URL.rstrip("/")
    return f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"


@lru_cache(maxsize=1)
def client() -> BaseClient:
    if not is_object_storage_enabled():
        raise RuntimeError("Cloudflare R2 is not configured.")
    return boto3.client(
        "s3",
        endpoint_url=_endpoint_url(),
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "standard"},
        ),
    )


def object_uri(key: str) -> str:
    cleaned = key.lstrip("/")
    return f"r2://{quote(R2_BUCKET_NAME, safe='')}/{quote(cleaned, safe='/')}"


def parse_object_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("r2://"):
        raise ValueError("Not an R2 object URI.")
    remainder = uri[5:]
    bucket, separator, key = remainder.partition("/")
    if not separator or not bucket or not key:
        raise ValueError("Invalid R2 object URI.")
    return unquote(bucket), unquote(key)


def is_object_uri(value: str) -> bool:
    return value.startswith("r2://")


def upload_file(local_path: str | Path, key: str, content_type: str | None = None) -> str:
    source = Path(local_path)
    if not source.is_file():
        raise FileNotFoundError(source)
    extra_args = {"ContentType": content_type} if content_type else None
    if extra_args:
        client().upload_file(str(source), R2_BUCKET_NAME, key, ExtraArgs=extra_args)
    else:
        client().upload_file(str(source), R2_BUCKET_NAME, key)
    return object_uri(key)


def create_multipart_upload(key: str, content_type: str | None = None) -> str:
    params: dict[str, object] = {"Bucket": R2_BUCKET_NAME, "Key": key}
    if content_type:
        params["ContentType"] = content_type
    response = client().create_multipart_upload(**params)
    return str(response["UploadId"])


def create_presigned_part_url(key: str, upload_id: str, part_number: int) -> str:
    if part_number < 1 or part_number > 10000:
        raise ValueError("Multipart part number must be between 1 and 10000.")
    return client().generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": R2_BUCKET_NAME,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=R2_PRESIGNED_URL_SECONDS,
    )


def complete_multipart_upload(key: str, upload_id: str, parts: list[dict[str, object]]) -> str:
    normalised = [
        {"PartNumber": int(part["part_number"]), "ETag": str(part["etag"]).strip('"')}
        for part in sorted(parts, key=lambda item: int(item["part_number"]))
    ]
    client().complete_multipart_upload(
        Bucket=R2_BUCKET_NAME,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={"Parts": normalised},
    )
    return object_uri(key)


def abort_multipart_upload(key: str, upload_id: str) -> None:
    client().abort_multipart_upload(
        Bucket=R2_BUCKET_NAME,
        Key=key,
        UploadId=upload_id,
    )


def materialize(uri_or_path: str, cache_dir: str | Path | None = None) -> Path:
    local = Path(uri_or_path)
    if local.is_file():
        return local
    if not is_object_uri(uri_or_path):
        raise FileNotFoundError(uri_or_path)

    bucket, key = parse_object_uri(uri_or_path)
    digest = hashlib.sha256(uri_or_path.encode("utf-8")).hexdigest()[:16]
    suffix = Path(key).suffix
    destination = Path(cache_dir or OBJECT_CACHE_DIR) / f"{digest}{suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.is_file():
        temporary = destination.with_suffix(destination.suffix + ".download")
        client().download_file(bucket, key, str(temporary))
        temporary.replace(destination)
    return destination


def persist_generated_file(
    local_path: str | Path,
    object_key: str,
    content_type: str | None = None,
) -> str:
    """Persist a generated media file and return the canonical storage reference."""
    source = Path(local_path)
    if not source.is_file():
        raise FileNotFoundError(source)
    if is_object_storage_enabled():
        return upload_file(source, object_key, content_type)
    return str(source)


def create_presigned_get_url(uri: str, expires_in: int | None = None) -> str:
    bucket, key = parse_object_uri(uri)
    return client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in or R2_PRESIGNED_URL_SECONDS,
    )


def storage_status() -> dict[str, object]:
    status: dict[str, object] = {
        "enabled": is_object_storage_enabled(),
        "provider": "cloudflare-r2",
        "bucket": R2_BUCKET_NAME or None,
    }
    if not is_object_storage_enabled():
        status["healthy"] = False
        status["message"] = "R2 environment variables are not configured."
        status["detail"] = status["message"]
        return status
    try:
        client().head_bucket(Bucket=R2_BUCKET_NAME)
        status["healthy"] = True
        status["message"] = "Cloudflare R2 is reachable."
        status["detail"] = status["message"]
    except Exception as exc:  # pragma: no cover - provider/network dependent
        status["healthy"] = False
        status["message"] = str(exc)[:300]
        status["detail"] = status["message"]
    return status
