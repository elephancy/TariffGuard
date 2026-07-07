from __future__ import annotations

import argparse
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr


def session_index_key(item: dict[str, Any]) -> str:
    return f"STARTED#{item['startedAt']}#{item['sessionId']}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill the global session listing index for existing TariffGuard rows."
    )
    parser.add_argument("--table-name", required=True)
    parser.add_argument("--region", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    table = dynamodb.Table(args.table_name)
    scanned = 0
    updated = 0
    kwargs: dict[str, Any] = {
        "FilterExpression": Attr("entityType").eq("SESSION") & Attr("GSI2PK").not_exists(),
        "ProjectionExpression": "PK, SK, sessionId, startedAt",
    }

    while True:
        response = table.scan(**kwargs)
        for item in response.get("Items", []):
            scanned += 1
            if args.dry_run:
                print(f"would update {item['PK']} {item['SK']}")
                continue
            table.update_item(
                Key={"PK": item["PK"], "SK": item["SK"]},
                UpdateExpression="SET GSI2PK = :pk, GSI2SK = :sk",
                ExpressionAttributeValues={
                    ":pk": "SESSIONS",
                    ":sk": session_index_key(item),
                },
            )
            updated += 1
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key

    print(f"scanned_missing_index={scanned} updated={updated}")


if __name__ == "__main__":
    main()
