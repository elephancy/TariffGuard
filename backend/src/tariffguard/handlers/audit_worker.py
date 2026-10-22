from __future__ import annotations

import os
from collections import Counter
from decimal import Decimal
from typing import Any

from tariffguard.repositories.dynamodb_repo import DynamoRepository
from tariffguard.utils.observability import observe
from tariffguard.utils.time import iso_now


def repo() -> DynamoRepository:
    return DynamoRepository(
        main_table_name=os.environ["MAIN_TABLE_NAME"],
        idempotency_table_name=os.environ["IDEMPOTENCY_TABLE_NAME"],
    )


@observe("audit")
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    del event, context
    store = repo()
    date = iso_now()[:10]
    sessions = [
        item
        for item in store.all_sessions_scan()
        if str(item.get("startedAt", ""))[:10] == date
        and item.get("status") != "INVALIDATED"
    ]
    counts = Counter(item.get("status", "UNKNOWN") for item in sessions)
    revenue = sum(
        Decimal(str((item.get("price") or {}).get("displayTotal", "0"))) for item in sessions
    )
    summary = {
        "date": date,
        "sessions": len(sessions),
        "validated": counts["VALIDATED"],
        "flagged": counts["FLAGGED"],
        "rejected": counts["REJECTED"],
        "estimatedRevenue": str(revenue),
        "createdAt": iso_now(),
    }
    store.put_audit_summary(date, summary)
    return summary
