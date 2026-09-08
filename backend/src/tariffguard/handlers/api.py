from __future__ import annotations

import json
import os
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import date as dt_date
from datetime import timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from tariffguard.models.session import SessionIngest, SessionRecord, ValidationFlag
from tariffguard.models.tariff import TariffVersion
from tariffguard.repositories.cognito_repo import CognitoRepository
from tariffguard.repositories.dynamodb_repo import (
    DuplicateChangedPayload,
    DuplicateSamePayload,
    DuplicateTariffVersion,
    DynamoRepository,
)
from tariffguard.services.idempotency import idempotency_key, payload_hash
from tariffguard.services.overview import build_overview
from tariffguard.utils.response import no_content, response
from tariffguard.utils.time import iso_now


def repo() -> DynamoRepository:
    return DynamoRepository(
        main_table_name=os.environ["MAIN_TABLE_NAME"],
        idempotency_table_name=os.environ["IDEMPOTENCY_TABLE_NAME"],
        sqs_queue_url=os.environ.get("SQS_QUEUE_URL"),
    )


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    return json.loads(raw) if isinstance(raw, str) else raw


def _route(event: dict[str, Any]) -> tuple[str, str]:
    request = event.get("requestContext", {}).get("http", {})
    return request.get("method", event.get("httpMethod", "GET")), event.get(
        "rawPath", event.get("path", "/")
    )


class InvalidateRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=240)


class UserCreateRequest(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: Literal["operator", "admin"] = "operator"


class UserStatusRequest(BaseModel):
    enabled: bool


def _groups(event: dict[str, Any]) -> set[str]:
    value = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
        .get("cognito:groups", "")
    )
    if isinstance(value, list):
        return set(value)
    return {item.strip() for item in str(value).strip("[]").split(",") if item.strip()}


def _page_cursor(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        decoded = json.loads(urlsafe_b64decode(value.encode()).decode())
        return decoded if isinstance(decoded, dict) else None
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("invalid cursor") from None


def _cursor(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    encoded = json.dumps(value, separators=(",", ":"), sort_keys=True)
    return urlsafe_b64encode(encoded.encode()).decode()


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    del context
    cors_origin = os.environ.get("CORS_ORIGIN", "*")
    method, path = _route(event)
    store = repo()

    if method == "OPTIONS":
        return no_content(cors_origin=cors_origin)
    if method == "GET" and path == "/health":
        return response(200, {"status": "ok"}, cors_origin=cors_origin)
    if method == "POST" and path == "/tariffs":
        try:
            tariff = TariffVersion.model_validate(_body(event))
        except ValidationError as exc:
            return response(
                400, {"error": "validation_error", "details": exc.errors()}, cors_origin=cors_origin
            )
        try:
            store.put_tariff(tariff)
        except DuplicateTariffVersion:
            return response(
                409,
                {
                    "error": "tariff_version_exists",
                    "message": "This effective date already exists.",
                },
                cors_origin=cors_origin,
            )
        return response(201, tariff.model_dump(mode="json"), cors_origin=cors_origin)
    if method == "GET" and path == "/tariffs":
        return response(200, {"tariffs": store.list_tariffs()}, cors_origin=cors_origin)
    if method == "GET" and path.startswith("/tariffs/") and path.endswith("/versions"):
        tariff_id = path.split("/")[2]
        return response(
            200,
            {
                "versions": [
                    item.model_dump(mode="json") for item in store.get_tariff_versions(tariff_id)
                ]
            },
            cors_origin=cors_origin,
        )
    if method == "POST" and path == "/sessions":
        try:
            payload = _body(event)
            session = SessionIngest.model_validate(payload)
        except (ValidationError, json.JSONDecodeError) as exc:
            details = exc.errors() if isinstance(exc, ValidationError) else str(exc)
            return response(
                400, {"error": "validation_error", "details": details}, cors_origin=cors_origin
            )
        key = idempotency_key(session.sessionId)
        digest = payload_hash(session.model_dump())
        try:
            store.put_idempotency(key, digest, session.sessionId)
        except DuplicateSamePayload as exc:
            existing = store.get_session(exc.session_id)
            if existing is None:
                now = iso_now()
                record = SessionRecord(
                    **session.model_dump(),
                    status="PENDING_VALIDATION",
                    rawPayload=session.model_dump(mode="json"),
                    createdAt=now,
                    updatedAt=now,
                )
                store.put_pending_session(record)
                store.enqueue_session(session.sessionId)
                return response(
                    202,
                    {"sessionId": session.sessionId, "status": "PENDING_VALIDATION"},
                    cors_origin=cors_origin,
                )
            if existing.get("status") == "PENDING_VALIDATION":
                store.enqueue_session(session.sessionId)
                return response(202, existing, cors_origin=cors_origin)
            return response(
                200,
                existing,
                cors_origin=cors_origin,
            )
        except DuplicateChangedPayload:
            return response(
                409,
                {
                    "error": "idempotency_conflict",
                    "message": "same session ID with changed payload",
                },
                cors_origin=cors_origin,
            )
        now = iso_now()
        record = SessionRecord(
            **session.model_dump(),
            status="PENDING_VALIDATION",
            rawPayload=session.model_dump(mode="json"),
            createdAt=now,
            updatedAt=now,
        )
        store.put_pending_session(record)
        store.enqueue_session(session.sessionId)
        return response(
            202,
            {"sessionId": session.sessionId, "status": "PENDING_VALIDATION"},
            cors_origin=cors_origin,
        )
    if method == "GET" and path == "/sessions":
        params = event.get("queryStringParameters") or {}
        try:
            limit = min(100, max(1, int(params.get("limit", "50"))))
            cursor = _page_cursor(params.get("cursor"))
        except ValueError:
            return response(400, {"error": "invalid_pagination"}, cors_origin=cors_origin)
        search = (params.get("search") or "").strip() or None
        sessions, next_cursor, stats = store.list_sessions(
            limit=limit, cursor=cursor, status=params.get("status"), search=search
        )
        return response(
            200,
            {
                "sessions": sessions,
                "nextCursor": _cursor(next_cursor),
                "total": stats["total"],
                "stats": stats,
            },
            cors_origin=cors_origin,
        )
    if method == "POST" and path.startswith("/sessions/") and path.endswith("/invalidate"):
        session_id = path.split("/")[2]
        try:
            request = InvalidateRequest.model_validate(_body(event))
        except ValidationError as exc:
            return response(
                400, {"error": "validation_error", "details": exc.errors()}, cors_origin=cors_origin
            )
        item = store.get_session(session_id)
        if not item:
            return response(404, {"error": "not_found"}, cors_origin=cors_origin)
        record = SessionRecord.model_validate(item)
        if record.status == "INVALIDATED":
            return response(200, record.model_dump(mode="json"), cors_origin=cors_origin)
        record.status = "INVALIDATED"
        record.updatedAt = iso_now()
        record.validationFlags.append(
            ValidationFlag(
                code="MANUALLY_INVALIDATED",
                severity="LOW",
                message=request.reason,
                rejectsSession=False,
            )
        )
        store.update_session_result(record)
        return response(200, record.model_dump(mode="json"), cors_origin=cors_origin)
    if method == "GET" and path.startswith("/sessions/"):
        session = store.get_session(path.split("/")[2])
        return response(
            200 if session else 404, session or {"error": "not_found"}, cors_origin=cors_origin
        )
    if method == "GET" and path.startswith("/chargers/") and path.endswith("/sessions"):
        charger_id = path.split("/")[2]
        return response(
            200, {"sessions": store.list_charger_sessions(charger_id)}, cors_origin=cors_origin
        )
    if method == "GET" and path == "/alerts":
        date = (event.get("queryStringParameters") or {}).get("date", iso_now()[:10])
        return response(200, {"alerts": store.list_alerts(date)}, cors_origin=cors_origin)
    if method == "GET" and path == "/audit/daily":
        date = (event.get("queryStringParameters") or {}).get("date", iso_now()[:10])
        return response(
            200,
            store.get_audit_summary(date) or {"date": date, "sessions": 0},
            cors_origin=cors_origin,
        )
    if method == "GET" and path == "/overview":
        overview_date = (event.get("queryStringParameters") or {}).get("date", iso_now()[:10])
        selected = dt_date.fromisoformat(overview_date)
        start = (selected - timedelta(days=6)).isoformat()
        return response(
            200,
            build_overview(
                store.list_sessions_between(start_date=start, end_date=selected.isoformat()),
                store.list_alerts(overview_date),
                overview_date,
            ),
            cors_origin=cors_origin,
        )
    if path.startswith("/admin/"):
        if "admins" not in _groups(event):
            return response(403, {"error": "admin_required"}, cors_origin=cors_origin)
        users = CognitoRepository(os.environ["USER_POOL_ID"])
        if method == "GET" and path == "/admin/users":
            return response(200, {"users": users.list_users()}, cors_origin=cors_origin)
        if method == "POST" and path == "/admin/users":
            try:
                request = UserCreateRequest.model_validate(_body(event))
            except ValidationError as exc:
                return response(
                    400,
                    {"error": "validation_error", "details": exc.errors()},
                    cors_origin=cors_origin,
                )
            return response(
                201, users.create_user(request.email, request.role), cors_origin=cors_origin
            )
        if method == "POST" and path.startswith("/admin/users/") and path.endswith("/status"):
            username = path.split("/")[3]
            try:
                request = UserStatusRequest.model_validate(_body(event))
            except ValidationError as exc:
                return response(
                    400,
                    {"error": "validation_error", "details": exc.errors()},
                    cors_origin=cors_origin,
                )
            users.set_enabled(username, request.enabled)
            return response(
                200,
                {"username": username, "enabled": request.enabled},
                cors_origin=cors_origin,
            )
    if method == "POST" and path == "/dev/seed":
        if os.environ.get("ENVIRONMENT") == "production":
            return response(404, {"error": "not_found"}, cors_origin=cors_origin)
        from tariffguard.seed_data import seed

        return response(201, seed(store), cors_origin=cors_origin)
    return response(404, {"error": "not_found", "path": path}, cors_origin=cors_origin)
