from __future__ import annotations

import argparse
import json
import random
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SCENARIOS_BY_SEVERITY = {
    "VALID": ("VALID_AC", "VALID_DC"),
    "LOW": ("LONG_SESSION",),
    "MEDIUM": ("ZERO_ENERGY", "LONG_IDLE"),
    "HIGH": (
        "EXCESSIVE_ENERGY",
        "SUSPICIOUS_POWER",
        "METER_REVERSED",
        "NEGATIVE_DURATION",
        "MISSING_TARIFF",
    ),
}

SEVERITY_WEIGHTS = {
    "VALID": 75,
    "LOW": 10,
    "MEDIUM": 5,
    "HIGH": 10,
}


def iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def daily_severity_weights(days: int, rng: random.Random) -> list[dict[str, int]]:
    profiles = []
    for _ in range(days):
        low = rng.randint(5, 15)
        medium = rng.randint(2, 10)
        high = rng.randint(4, 18)
        profiles.append(
            {
                "VALID": 100 - low - medium - high,
                "LOW": low,
                "MEDIUM": medium,
                "HIGH": high,
            }
        )
    return profiles


def build_session(
    index: int,
    rng: random.Random,
    anchor: datetime,
    severity: str | None = None,
    days: int = 7,
) -> dict[str, object]:
    severity = severity or rng.choices(
        tuple(SEVERITY_WEIGHTS), weights=tuple(SEVERITY_WEIGHTS.values()), k=1
    )[0]
    scenario = rng.choice(SCENARIOS_BY_SEVERITY[severity])
    day_offset = index % days
    started = (anchor - timedelta(days=day_offset)).replace(
        hour=rng.randint(5, 22), minute=rng.randint(0, 59), second=rng.randint(0, 59)
    )
    duration = rng.randint(18, 240)
    energy = Decimal(str(round(rng.uniform(4.5, 82.0), 3)))
    idle = rng.randint(0, 35)
    tariff_id = "berlin_public_standard"

    if scenario == "VALID_DC":
        duration = rng.randint(12, 55)
        energy = Decimal(str(round(rng.uniform(25, 95), 3)))
    elif scenario == "LONG_SESSION":
        duration = rng.randint(361, 540)
        energy = Decimal(str(round(rng.uniform(20, 85), 3)))
    elif scenario == "ZERO_ENERGY":
        duration, energy = rng.randint(45, 180), Decimal("0")
    elif scenario == "EXCESSIVE_ENERGY":
        duration, energy = rng.randint(120, 360), Decimal(str(rng.randint(151, 245)))
    elif scenario == "SUSPICIOUS_POWER":
        duration, energy = rng.randint(5, 12), Decimal(str(rng.randint(75, 115)))
    elif scenario == "LONG_IDLE":
        idle = rng.randint(121, 320)
    elif scenario == "METER_REVERSED":
        energy = Decimal(str(-rng.uniform(1, 18))).quantize(Decimal("0.001"))
    elif scenario == "NEGATIVE_DURATION":
        duration = -rng.randint(2, 90)
    elif scenario == "MISSING_TARIFF":
        tariff_id = "RETIRED-NO-VERSION"

    meter_start = Decimal(str(rng.randint(1_500, 95_000))) / Decimal("10")
    meter_stop = meter_start + energy
    return {
        "sessionId": f"demo-{anchor:%Y%m%d%H%M}-{index:04d}-{scenario.lower()}",
        "chargerId": (
            f"DE-{rng.choice(('BER', 'HAM', 'MUC', 'FRA', 'CGN'))}-"
            f"{rng.randint(1, 32):03d}"
        ),
        "userId": f"driver-{rng.randint(1000, 1199)}",
        "startedAt": iso(started),
        "stoppedAt": iso(started + timedelta(minutes=duration)),
        "meterStartKwh": str(meter_start.quantize(Decimal("0.001"))),
        "meterStopKwh": str(meter_stop.quantize(Decimal("0.001"))),
        "idleMinutes": idle,
        "tariffId": tariff_id,
    }


def post(url: str, payload: dict[str, object], token: str | None) -> int:
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    request = Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    for attempt in range(6):
        try:
            with urlopen(request, timeout=20) as response:
                return response.status
        except HTTPError as exc:
            if exc.code not in {429, 500, 502, 503, 504} or attempt == 5:
                raise
            time.sleep(0.5 * (2**attempt))
    raise RuntimeError("request retries exhausted")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate varied TariffGuard demo traffic.")
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--access-token")
    parser.add_argument("--seed", type=int, default=20260701)
    parser.add_argument("--delay-ms", type=int, default=125)
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days must be at least 1")

    rng = random.Random(args.seed)
    profiles = daily_severity_weights(args.days, random.Random(args.seed + 1))
    anchor = datetime.now(UTC).replace(microsecond=0)
    counts: dict[int, int] = {}
    for index in range(args.count):
        profile = profiles[index % args.days]
        severity = rng.choices(
            tuple(profile), weights=tuple(profile.values()), k=1
        )[0]
        status = post(
            f"{args.api_url.rstrip('/')}/sessions",
            build_session(index, rng, anchor, severity, args.days),
            args.access_token,
        )
        counts[status] = counts.get(status, 0) + 1
        if (index + 1) % 25 == 0 or index + 1 == args.count:
            print(f"submitted {index + 1}/{args.count} {counts}")
        time.sleep(max(0, args.delay_ms) / 1000)


if __name__ == "__main__":
    main()
