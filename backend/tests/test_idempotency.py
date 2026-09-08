from decimal import Decimal

from tariffguard.services.idempotency import idempotency_key, payload_hash


def test_payload_hash_is_stable_for_equivalent_payload_ordering() -> None:
    left = {
        "sessionId": "sess_001",
        "chargerId": "BER-CP-014",
        "meterStartKwh": Decimal("1210.4"),
        "meterStopKwh": Decimal("1242.8"),
    }
    right = {
        "meterStopKwh": Decimal("1242.8"),
        "meterStartKwh": Decimal("1210.4"),
        "chargerId": "BER-CP-014",
        "sessionId": "sess_001",
    }

    assert payload_hash(left) == payload_hash(right)


def test_payload_hash_changes_when_payload_changes() -> None:
    original = {"sessionId": "sess_001", "chargerId": "BER-CP-014", "idleMinutes": 20}
    changed = {"sessionId": "sess_001", "chargerId": "BER-CP-014", "idleMinutes": 21}

    assert payload_hash(original) != payload_hash(changed)


def test_idempotency_key_matches_global_session_storage_identity() -> None:
    assert idempotency_key("sess_001") == "sess_001"
