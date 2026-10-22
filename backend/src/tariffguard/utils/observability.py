"""Small, allowlisted application events for the existing Lambda CloudWatch sink."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from functools import wraps
from time import monotonic
from typing import Any, Literal

from tariffguard.utils.logging import logger


def emit(event: str, **fields: Any) -> None:
    # Callers supply fixed schemas, never request bodies or exception text.
    # Observability must not replace a business result or the original exception.
    try:
        level = logging.ERROR if event in {"client.error", "invocation.failed"} else logging.INFO
        logger.log(level, json.dumps({"event": event, **fields}, separators=(",", ":")))
    except Exception:
        pass


def observe(service: Literal["api", "audit", "validation"]) -> Callable:
    def decorate(handler: Callable) -> Callable:
        @wraps(handler)
        def wrapped(event: dict[str, Any], context: Any) -> dict[str, Any]:
            started = monotonic()
            fields: dict[str, Any] = {"service": service}
            outcome = "invocation.failed"
            if service == "api":
                fields["status_code"] = 500
            try:
                result = handler(event, context)
                outcome = "invocation.completed"
                if service == "api":
                    fields["status_code"] = result["statusCode"]
                if service == "validation":
                    fields["failed_records"] = len(result.get("batchItemFailures", []))
                return result
            finally:
                fields["duration_ms"] = max(0, int((monotonic() - started) * 1000))
                emit(outcome, **fields)

        return wrapped

    return decorate
