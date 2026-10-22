from __future__ import annotations

import argparse
import json
from urllib.error import HTTPError
from urllib.request import Request

from http_client import open_http

TARIFF = {
    "tariffId": "berlin_public_standard",
    "currency": "EUR",
    "validFrom": "2026-06-01T00:00:00Z",
    "pricePerKwh": "0.49",
    "sessionFee": "0.35",
    "idleFeePerMinute": "0.10",
    "idleGraceMinutes": 15,
    "taxRate": "0.19",
}

SESSIONS = [
    {
        "sessionId": "sess_001",
        "chargerId": "BER-CP-014",
        "userId": "user_928",
        "startedAt": "2026-06-30T08:10:00Z",
        "stoppedAt": "2026-06-30T09:25:00Z",
        "meterStartKwh": "1210.4",
        "meterStopKwh": "1242.8",
        "idleMinutes": 20,
        "tariffId": "berlin_public_standard",
    },
    {
        "sessionId": "sess_reversed",
        "chargerId": "BER-CP-014",
        "userId": "user_929",
        "startedAt": "2026-06-30T10:10:00Z",
        "stoppedAt": "2026-06-30T11:10:00Z",
        "meterStartKwh": "1300.0",
        "meterStopKwh": "1299.0",
        "idleMinutes": 0,
        "tariffId": "berlin_public_standard",
    },
    {
        "sessionId": "sess_power",
        "chargerId": "BER-CP-021",
        "userId": "user_930",
        "startedAt": "2026-06-30T12:00:00Z",
        "stoppedAt": "2026-06-30T12:10:00Z",
        "meterStartKwh": "100.0",
        "meterStopKwh": "170.0",
        "idleMinutes": 0,
        "tariffId": "berlin_public_standard",
    },
]


def post(
    api_url: str, path: str, payload: dict, access_token: str | None = None
) -> tuple[int, str]:
    headers = {"content-type": "application/json"}
    if access_token:
        headers["authorization"] = f"Bearer {access_token}"
    request = Request(
        f"{api_url.rstrip('/')}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with open_http(request, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--access-token")
    args = parser.parse_args()

    print("Creating tariff")
    print(post(args.api_url, "/tariffs", TARIFF, args.access_token))
    for session in SESSIONS:
        print(f"Submitting {session['sessionId']}")
        print(post(args.api_url, "/sessions", session, args.access_token))


if __name__ == "__main__":
    main()
