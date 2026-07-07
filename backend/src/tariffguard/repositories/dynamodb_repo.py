from __future__ import annotations

from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from tariffguard.models.alert import AlertRecord
from tariffguard.models.session import SessionRecord
from tariffguard.models.tariff import TariffVersion
from tariffguard.utils.time import day_from_iso, iso_now, parse_iso


def _dump(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return _dump(value.model_dump(mode="json"))
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, list):
        return [_dump(item) for item in value]
    if isinstance(value, dict):
        return {key: _dump(item) for key, item in value.items()}
    return value


def _session_index_key(started_at: str, session_id: str) -> str:
    return f"STARTED#{started_at}#{session_id}"


SESSION_LIST_PROJECTION = (
    "sessionId, chargerId, userId, startedAt, stoppedAt, meterStartKwh, meterStopKwh, "
    "idleMinutes, tariffId, #session_status, price, validationFlags"
)
SESSION_STATS_PROJECTION = "#session_status, price"


class DuplicateSamePayload(Exception):
    def __init__(self, session_id: str) -> None:
        super().__init__("duplicate same payload")
        self.session_id = session_id


class DuplicateChangedPayload(Exception):
    pass


class DuplicateTariffVersion(Exception):
    pass


def _session_filter(status: str | None, search: str | None) -> Any | None:
    expression = Attr("status").eq(status) if status else None
    if search:
        search_expression = (
            Attr("sessionId").contains(search)
            | Attr("chargerId").contains(search)
            | Attr("userId").contains(search)
        )
        expression = search_expression if expression is None else expression & search_expression
    return expression


class DynamoRepository:
    def __init__(
        self,
        *,
        main_table_name: str,
        idempotency_table_name: str,
        sqs_queue_url: str | None = None,
        dynamodb_resource: Any | None = None,
        sqs_client: Any | None = None,
    ) -> None:
        dynamodb = dynamodb_resource or boto3.resource("dynamodb")
        self.main = dynamodb.Table(main_table_name)
        self.idempotency = dynamodb.Table(idempotency_table_name)
        self.sqs = sqs_client or boto3.client("sqs")
        self.sqs_queue_url = sqs_queue_url

    def put_idempotency(self, key: str, payload_hash: str, session_id: str) -> None:
        try:
            self.idempotency.put_item(
                Item={
                    "idempotencyKey": key,
                    "payloadHash": payload_hash,
                    "sessionId": session_id,
                    "createdAt": iso_now(),
                },
                ConditionExpression="attribute_not_exists(idempotencyKey)",
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            existing = self.idempotency.get_item(Key={"idempotencyKey": key}).get("Item", {})
            if existing.get("payloadHash") == payload_hash:
                raise DuplicateSamePayload(existing.get("sessionId", session_id)) from exc
            raise DuplicateChangedPayload() from exc

    def put_tariff(self, tariff: TariffVersion) -> None:
        item = _dump(tariff)
        item.update(
            {
                "PK": f"TARIFF#{tariff.tariffId}",
                "SK": f"VERSION#{tariff.validFrom}",
                "entityType": "TARIFF_VERSION",
                "GSI1PK": "TARIFFS",
                "GSI1SK": f"{tariff.tariffId}#{tariff.validFrom}",
            }
        )
        try:
            self.main.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)",
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise DuplicateTariffVersion() from exc
            raise

    def list_tariffs(self) -> list[dict[str, Any]]:
        response = self.main.query(
            IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq("TARIFFS")
        )
        grouped: dict[str, list[dict[str, Any]]] = {}
        for item in response.get("Items", []):
            grouped.setdefault(item["tariffId"], []).append(item)
        result = []
        for tariff_id, versions in grouped.items():
            versions.sort(key=lambda item: item["validFrom"], reverse=True)
            result.append(
                {"tariffId": tariff_id, "versions": len(versions), "currentVersion": versions[0]}
            )
        return sorted(result, key=lambda item: item["tariffId"])

    def get_tariff_versions(self, tariff_id: str) -> list[TariffVersion]:
        response = self.main.query(
            KeyConditionExpression=Key("PK").eq(f"TARIFF#{tariff_id}")
            & Key("SK").begins_with("VERSION#"),
            ScanIndexForward=False,
        )
        return [TariffVersion.model_validate(item) for item in response.get("Items", [])]

    def get_tariff_for_timestamp(self, tariff_id: str, timestamp: str) -> TariffVersion | None:
        versions = self.get_tariff_versions(tariff_id)
        session_time = parse_iso(timestamp)
        applicable = [
            version for version in versions if parse_iso(version.validFrom) <= session_time
        ]
        return max(applicable, key=lambda version: parse_iso(version.validFrom), default=None)

    def put_pending_session(self, session: SessionRecord) -> None:
        item = _dump(session)
        now = iso_now()
        session_item = {
            **item,
            "PK": f"SESSION#{session.sessionId}",
            "SK": "METADATA",
            "entityType": "SESSION",
            "GSI1PK": f"CHARGER#{session.chargerId}",
            "GSI1SK": f"SESSION#{session.startedAt}#{session.sessionId}",
            "GSI2PK": "SESSIONS",
            "GSI2SK": _session_index_key(session.startedAt, session.sessionId),
        }
        charger_item = {
            **item,
            "PK": f"CHARGER#{session.chargerId}",
            "SK": f"SESSION#{session.startedAt}#{session.sessionId}",
            "entityType": "CHARGER_SESSION",
            "sessionPK": f"SESSION#{session.sessionId}",
            "updatedAt": now,
        }
        self.main.put_item(Item=session_item)
        self.main.put_item(Item=charger_item)

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.main.get_item(Key={"PK": f"SESSION#{session_id}", "SK": "METADATA"}).get("Item")

    def update_session_result(self, record: SessionRecord) -> None:
        self.put_pending_session(record)

    def list_charger_sessions(self, charger_id: str) -> list[dict[str, Any]]:
        response = self.main.query(
            KeyConditionExpression=Key("PK").eq(f"CHARGER#{charger_id}")
            & Key("SK").begins_with("SESSION#"),
            ScanIndexForward=False,
        )
        return response.get("Items", [])

    def put_alerts(self, alerts: list[AlertRecord]) -> None:
        for alert in alerts:
            item = _dump(alert)
            item.update(
                {
                    "PK": f"ALERT_DAY#{alert.date}",
                    "SK": f"ALERT#{alert.severity}#{alert.sessionId}#{alert.flagCode}",
                    "entityType": "ALERT",
                }
            )
            self.main.put_item(Item=item)

    def list_alerts(self, date: str) -> list[dict[str, Any]]:
        response = self.main.query(
            KeyConditionExpression=Key("PK").eq(f"ALERT_DAY#{date}")
            & Key("SK").begins_with("ALERT#")
        )
        return response.get("Items", [])

    def put_audit_summary(self, date: str, summary: dict[str, Any]) -> None:
        self.main.put_item(
            Item={
                "PK": f"AUDIT_DAY#{date}",
                "SK": "SUMMARY",
                "entityType": "AUDIT_SUMMARY",
                **_dump(summary),
            }
        )

    def get_audit_summary(self, date: str) -> dict[str, Any] | None:
        return self.main.get_item(Key={"PK": f"AUDIT_DAY#{date}", "SK": "SUMMARY"}).get("Item")

    def recent_sessions_scan(self, limit: int = 25) -> list[dict[str, Any]]:
        return self.all_sessions_scan()[:limit]

    def all_sessions_scan(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        kwargs: dict[str, Any] = {
            "FilterExpression": "entityType = :entity",
            "ExpressionAttributeValues": {":entity": "SESSION"},
        }
        while True:
            response = self.main.scan(**kwargs)
            items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            kwargs["ExclusiveStartKey"] = last_key
        return sorted(items, key=lambda item: item.get("startedAt", ""), reverse=True)

    def list_sessions_between(self, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        kwargs: dict[str, Any] = {
            "IndexName": "GSI2",
            "KeyConditionExpression": Key("GSI2PK").eq("SESSIONS")
            & Key("GSI2SK").between(f"STARTED#{start_date}", f"STARTED#{end_date}~"),
            "ProjectionExpression": SESSION_LIST_PROJECTION,
            "ExpressionAttributeNames": {"#session_status": "status"},
            "ScanIndexForward": False,
        }
        while True:
            response = self.main.query(**kwargs)
            items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            kwargs["ExclusiveStartKey"] = last_key
        return items

    def list_sessions(
        self,
        *,
        limit: int = 50,
        cursor: dict[str, Any] | None = None,
        status: str | None = None,
        search: str | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None, dict[str, Any]]:
        items: list[dict[str, Any]] = []
        stats = self.session_stats(status=status, search=search)
        kwargs: dict[str, Any] = {
            "IndexName": "GSI2",
            "KeyConditionExpression": Key("GSI2PK").eq("SESSIONS"),
            "ProjectionExpression": SESSION_LIST_PROJECTION,
            "ExpressionAttributeNames": {"#session_status": "status"},
            "Limit": limit,
            "ScanIndexForward": False,
        }
        if cursor:
            kwargs["ExclusiveStartKey"] = cursor
        filter_expression = _session_filter(status, search)
        if filter_expression is not None:
            kwargs["FilterExpression"] = filter_expression

        last_key = None
        while len(items) < limit:
            response = self.main.query(**kwargs)
            items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            kwargs["ExclusiveStartKey"] = last_key
            kwargs["Limit"] = max(1, limit - len(items))

        return items[:limit], last_key, stats

    def session_stats(
        self, *, status: str | None = None, search: str | None = None
    ) -> dict[str, Any]:
        total = 0
        attention = 0
        revenue = Decimal("0")
        kwargs: dict[str, Any] = {
            "IndexName": "GSI2",
            "KeyConditionExpression": Key("GSI2PK").eq("SESSIONS"),
            "ProjectionExpression": SESSION_STATS_PROJECTION,
            "ExpressionAttributeNames": {"#session_status": "status"},
        }
        filter_expression = _session_filter(status, search)
        if filter_expression is not None:
            kwargs["FilterExpression"] = filter_expression

        while True:
            response = self.main.query(**kwargs)
            for item in response.get("Items", []):
                total += 1
                session_status = item.get("status")
                if session_status in {"FLAGGED", "REJECTED"}:
                    attention += 1
                revenue += Decimal(str((item.get("price") or {}).get("displayTotal", "0")))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            kwargs["ExclusiveStartKey"] = last_key

        return {
            "total": total,
            "attention": attention,
            "estimatedRevenue": str(revenue),
        }

    def enqueue_session(self, session_id: str) -> None:
        if not self.sqs_queue_url:
            raise RuntimeError("SQS_QUEUE_URL is not configured")
        self.sqs.send_message(
            QueueUrl=self.sqs_queue_url, MessageBody=f'{{"sessionId":"{session_id}"}}'
        )


def alerts_from_session(record: SessionRecord) -> list[AlertRecord]:
    now = iso_now()
    date = day_from_iso(record.startedAt)
    return [
        AlertRecord(
            alertId=f"{record.sessionId}:{flag.code}",
            date=date,
            sessionId=record.sessionId,
            chargerId=record.chargerId,
            flagCode=flag.code,
            severity=flag.severity,
            metric=flag.metric,
            createdAt=now,
        )
        for flag in record.validationFlags
        if flag.severity in {"MEDIUM", "HIGH"}
    ]
