import json
from uuid import uuid4

import pytest

from tariffguard.handlers import api, audit_worker
from tariffguard.utils import observability


def client_event(**changes):
    payload = {"eventId": str(uuid4()), "kind": "runtime_error", "screen": "dashboard"}
    payload.update(changes)
    return {
        "requestContext": {
            "http": {"method": "POST"},
            "authorizer": {"jwt": {"claims": {"sub": "never-log-this-user"}}},
        },
        "rawPath": "/client-errors",
        "body": json.dumps(payload),
    }


def test_authenticated_client_event_without_database(monkeypatch, caplog):
    monkeypatch.setattr(api, "repo", lambda: pytest.fail("telemetry must not open database"))
    event = client_event()
    result = api.handler(event, None)
    assert result["statusCode"] == 204
    events = [json.loads(record.message) for record in caplog.records]
    assert events[0] == {
        "event": "client.error", "service": "web", "event_id": json.loads(event["body"])["eventId"],
        "kind": "runtime_error", "screen": "dashboard",
    }
    assert events[1]["event"] == "invocation.completed"
    assert events[1]["status_code"] == 204
    assert caplog.records[0].levelname == "ERROR"
    assert "never-log-this-user" not in caplog.text


@pytest.mark.parametrize("changes", [
    {"message": "private@example.com"}, {"kind": "private@example.com"},
    {"screen": "/sessions/private-id?token=secret"}, {"eventId": "not-a-uuid"},
])
def test_client_payload_rejects_arbitrary_fields(changes, caplog):
    result = api.handler(client_event(**changes), None)
    assert result["statusCode"] == 400
    assert result["body"] == '{"error": "invalid_client_event"}'
    assert not any(json.loads(r.message)["event"] == "client.error" for r in caplog.records)
    assert "private" not in caplog.text


@pytest.mark.parametrize("body,encoded,status", [
    ("{", False, 400), ("[]", False, 400), ("x" * 1025, False, 413),
    ("{}", True, 400), ({}, False, 400), ("\ud800", False, 400),
])
def test_client_body_is_bounded(body, encoded, status):
    event = client_event()
    event.update(body=body, isBase64Encoded=encoded)
    assert api.handler(event, None)["statusCode"] == status


def test_client_report_requires_gateway_authorizer():
    event = client_event()
    del event["requestContext"]["authorizer"]
    assert api.handler(event, None)["statusCode"] == 401


def test_observer_preserves_original_exception_and_never_logs_payload(caplog):
    failure = RuntimeError("token=secret@example.com")

    @observability.observe("api")
    def broken(event, context):
        raise failure

    with pytest.raises(RuntimeError) as exc:
        broken({"rawPath": "/sessions/private", "body": "secret@example.com"}, None)
    assert exc.value is failure
    event = json.loads(caplog.records[0].message)
    assert event["event"] == "invocation.failed"
    assert event["status_code"] == 500
    assert caplog.records[0].levelname == "ERROR"
    assert "secret" not in caplog.text
    assert "private" not in caplog.text


def test_logging_failure_does_not_change_business_result_or_error(monkeypatch):
    def unavailable(*args, **kwargs):
        raise OSError("log sink unavailable")

    monkeypatch.setattr(observability.logger, "log", unavailable)
    assert api.handler(client_event(), None)["statusCode"] == 204

    monkeypatch.setattr(audit_worker, "repo", lambda: (_ for _ in ()).throw(ValueError("original")))
    with pytest.raises(ValueError, match="original"):
        audit_worker.handler({}, None)


def test_job_records_partial_failure_count_only(caplog):
    @observability.observe("validation")
    def partial(event, context):
        return {"batchItemFailures": [{"itemIdentifier": "private-session"}]}

    assert partial({}, None)["batchItemFailures"]
    logged = json.loads(caplog.records[0].message)
    assert logged["failed_records"] == 1
    assert logged["service"] == "validation"
    assert "private-session" not in caplog.text


def test_audit_success_preserves_summary_without_logging_financial_data(monkeypatch, caplog):
    class Store:
        def all_sessions_scan(self):
            return [{"startedAt": "2026-10-22T00:00:00Z", "status": "VALIDATED",
                     "price": {"displayTotal": "1234567.89"}}]

        def put_audit_summary(self, date, summary):
            assert summary["sessions"] == 1

    monkeypatch.setattr(audit_worker, "repo", Store)
    monkeypatch.setattr(audit_worker, "iso_now", lambda: "2026-10-22T01:00:00Z")
    result = audit_worker.handler({}, None)
    assert result["estimatedRevenue"] == "1234567.89"
    assert result["sessions"] == 1
    logged = json.loads(caplog.records[0].message)
    assert logged["event"] == "invocation.completed"
    assert logged["service"] == "audit"
    assert "1234567.89" not in caplog.text
