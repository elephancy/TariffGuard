from __future__ import annotations

import json
import os
from typing import Any

from tariffguard.models.session import SessionIngest, SessionRecord
from tariffguard.repositories.dynamodb_repo import DynamoRepository, alerts_from_session
from tariffguard.services.pricing import calculate_price
from tariffguard.services.validation import status_from_flags, validate_session
from tariffguard.utils.logging import log
from tariffguard.utils.observability import observe
from tariffguard.utils.time import iso_now


def repo() -> DynamoRepository:
    return DynamoRepository(
        main_table_name=os.environ["MAIN_TABLE_NAME"],
        idempotency_table_name=os.environ["IDEMPOTENCY_TABLE_NAME"],
    )


def process_session(store: DynamoRepository, session_id: str) -> None:
    item = store.get_session(session_id)
    if item is None:
        raise ValueError(f"session {session_id} not found")
    if item.get("status") == "INVALIDATED":
        log("session_validation_skipped", sessionId=session_id, reason="invalidated")
        return
    ingest = SessionIngest.model_validate(item["rawPayload"])
    tariff = store.get_tariff_for_timestamp(ingest.tariffId, ingest.startedAt)
    flags = validate_session(ingest, tariff)
    price = (
        None
        if any(flag.rejectsSession for flag in flags) or tariff is None
        else calculate_price(ingest, tariff)
    )
    now = iso_now()
    record = SessionRecord(
        **ingest.model_dump(),
        status=status_from_flags(flags),  # type: ignore[arg-type]
        rawPayload=ingest.model_dump(mode="json"),
        price=price,
        tariffSnapshot=tariff.model_dump(mode="json") if tariff else None,
        validationFlags=flags,
        createdAt=item.get("createdAt", now),
        updatedAt=now,
    )
    store.update_session_result(record)
    store.put_alerts(alerts_from_session(record))
    log(
        "session_validated",
        sessionId=session_id,
        status=record.status,
        flags=[flag.code for flag in flags],
    )


def mark_failed_processing(store: DynamoRepository, session_id: str, error: str) -> None:
    item = store.get_session(session_id)
    if item is None:
        return
    ingest = SessionIngest.model_validate(item["rawPayload"])
    now = iso_now()
    record = SessionRecord(
        **ingest.model_dump(),
        status="FAILED_PROCESSING",
        rawPayload=ingest.model_dump(mode="json"),
        price=item.get("price"),
        tariffSnapshot=item.get("tariffSnapshot"),
        validationFlags=item.get("validationFlags", []),
        createdAt=item.get("createdAt", now),
        updatedAt=now,
    )
    store.update_session_result(record)
    log("session_marked_failed_processing", sessionId=session_id, error=error)
    

@observe("validation")
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    del context
    store = repo()
    failures = []
    for record in event.get("Records", []):
        message_id = record.get("messageId")
        session_id = None
        try:
            body = json.loads(record.get("body") or "{}")
            session_id = body["sessionId"]
            process_session(store, session_id)
        except Exception as exc:  # noqa: BLE001 - Lambda must report per-record failures.
            log("session_validation_failed", messageId=message_id, error=str(exc))
            if session_id:
                try:
                    mark_failed_processing(store, session_id, str(exc))
                except Exception as mark_exc:  # noqa: BLE001 - keep original failure visible.
                    log(
                        "session_failed_processing_mark_failed",
                        sessionId=session_id,
                        error=str(mark_exc),
                    )
            if message_id:
                failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
