from __future__ import annotations

import logging
import os
import resource
import threading
import time
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger("rugby-video-analysis.resources")


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def is_hosted_runtime() -> bool:
    environment = os.getenv("ENVIRONMENT", os.getenv("APP_ENV", "")).lower()
    return bool(
        environment in {"production", "staging"}
        or os.getenv("RENDER")
        or os.getenv("RENDER_SERVICE_ID")
        or os.getenv("RENDER_EXTERNAL_URL")
    )


def embedded_worker_enabled() -> bool:
    configured = os.getenv("ENABLE_EMBEDDED_WORKER")
    if configured is not None:
        return truthy(configured)
    return not is_hosted_runtime()


def max_local_upload_bytes() -> int:
    configured = os.getenv("MAX_LOCAL_UPLOAD_BYTES")
    if configured:
        return int(configured)
    if is_hosted_runtime():
        return int(os.getenv("HOSTED_MAX_LOCAL_UPLOAD_BYTES", str(250 * 1024 * 1024)))
    configured = os.getenv("MAX_UPLOAD_BYTES")
    if configured:
        return int(configured)
    return 5 * 1024 * 1024 * 1024


def max_processing_video_bytes() -> int:
    configured = os.getenv("MAX_PROCESSING_VIDEO_BYTES")
    if configured:
        return int(configured)
    if is_hosted_runtime():
        return int(os.getenv("HOSTED_MAX_PROCESSING_VIDEO_BYTES", str(750 * 1024 * 1024)))
    return 0


def ffmpeg_thread_count() -> str:
    return os.getenv("FFMPEG_THREADS", "1")


def memory_usage_mb() -> dict[str, float]:
    self_usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    child_usage = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    # Linux reports KB; macOS reports bytes. Render is Linux, local dev is often macOS.
    divisor = 1024.0 if max(self_usage, child_usage) < 10_000_000 else 1024.0 * 1024.0
    return {
        "process_max_rss_mb": round(self_usage / divisor, 1),
        "child_max_rss_mb": round(child_usage / divisor, 1),
    }


_heavy_job_slots = max(1, int(os.getenv("MAX_CONCURRENT_HEAVY_JOBS", "1")))
_heavy_job_lock = threading.BoundedSemaphore(_heavy_job_slots)


@contextmanager
def heavy_operation(name: str, **details: object) -> Iterator[None]:
    acquire_timeout = float(os.getenv("HEAVY_JOB_ACQUIRE_TIMEOUT_SECONDS", "2"))
    acquired = _heavy_job_lock.acquire(timeout=acquire_timeout)
    if not acquired:
        raise RuntimeError(
            "Another video analysis operation is already running. Try again after the current job finishes."
        )

    started = time.monotonic()
    logger.info("heavy_operation_start name=%s details=%s memory=%s", name, details, memory_usage_mb())
    try:
        yield
    finally:
        elapsed = round(time.monotonic() - started, 3)
        logger.info(
            "heavy_operation_end name=%s elapsed_seconds=%s details=%s memory=%s",
            name,
            elapsed,
            details,
            memory_usage_mb(),
        )
        _heavy_job_lock.release()


def runtime_diagnostics() -> dict[str, object]:
    return {
        "hosted_runtime": is_hosted_runtime(),
        "embedded_worker_enabled": embedded_worker_enabled(),
        "max_concurrent_heavy_jobs": _heavy_job_slots,
        "max_local_upload_bytes": max_local_upload_bytes(),
        "max_processing_video_bytes": max_processing_video_bytes(),
        "ffmpeg_threads": ffmpeg_thread_count(),
        "memory": memory_usage_mb(),
    }
