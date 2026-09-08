import io
import zipfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "uipath"


def _zip_fixture(name: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in (FIXTURES / name).rglob("*"):
            if f.is_file():
                zf.write(f, arcname=f.relative_to(FIXTURES / name))
    return buf.getvalue()


def _create_automation(client, name: str) -> int:
    ws = client.post("/workspaces", json={"name": "BC Test Workspace"}).json()
    upload = client.post(
        f"/workspaces/{ws['id']}/uploads",
        data={"automation_name": name},
        files={"file": (f"{name}.zip", _zip_fixture(name), "application/zip")},
    ).json()
    return upload["automation_id"]


def test_get_business_context_defaults_to_unknown(client):
    automation_id = _create_automation(client, "unknown_context_mutator")
    biz = client.get(f"/automations/{automation_id}/business-context").json()
    assert biz["customer_impact"] == "UNKNOWN"
    assert biz["mandatory_approval"] == "UNKNOWN"


def test_put_business_context_persists_and_triggers_reassessment(client):
    automation_id = _create_automation(client, "unknown_context_mutator")

    before = client.get(f"/automations/{automation_id}/assessments/latest").json()
    before_ceiling = before["recommendation"]["maximum_safe_state"]
    assert before_ceiling != "HIGH_AUTONOMY"  # capped by insufficient context

    payload = {
        "customer_impact": "NONE", "financial_impact": "LOW", "legal_regulatory_impact": "NONE",
        "employee_impact": "NONE", "external_party_impact": "NONE", "maximum_scope": "INTERNAL_ONLY",
        "monetary_exposure": "LOW", "human_accountability_required": "NO", "mandatory_approval": "NO",
        "irreversible_action": "NO", "regulated_process": "NO", "sensitive_data": "NO", "critical_service": "NO",
        "process_owner": "Ops Team", "business_description": None, "known_policies": None,
        "known_constraints": None, "notes": None,
    }
    result = client.put(f"/automations/{automation_id}/business-context", json=payload)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["business_context"]["mandatory_approval"] == "NO"
    assert body["assessment"] is not None

    # Persisted: a fresh GET reflects the saved values.
    refetched = client.get(f"/automations/{automation_id}/business-context").json()
    assert refetched["process_owner"] == "Ops Team"
    assert refetched["mandatory_approval"] == "NO"

    # Reassessed: a new assessment exists and the ceiling improved now that
    # context confirms low/no risk.
    assessments = client.get(f"/automations/{automation_id}/assessments").json()
    assert len(assessments) == 2
    after = client.get(f"/automations/{automation_id}/assessments/latest").json()
    assert after["id"] != before["id"]


def test_business_context_change_appears_in_reassessment_diff_and_history(client):
    automation_id = _create_automation(client, "customer_exclusion")
    client.put(
        f"/automations/{automation_id}/business-context",
        json={
            "customer_impact": "HIGH", "financial_impact": "UNKNOWN", "legal_regulatory_impact": "UNKNOWN",
            "employee_impact": "UNKNOWN", "external_party_impact": "UNKNOWN", "maximum_scope": "MULTIPLE_CASES",
            "monetary_exposure": "UNKNOWN", "human_accountability_required": "YES", "mandatory_approval": "YES",
            "irreversible_action": "YES", "regulated_process": "YES", "sensitive_data": "UNKNOWN",
            "critical_service": "UNKNOWN", "process_owner": None, "business_description": None,
            "known_policies": None, "known_constraints": None, "notes": None,
        },
    )
    diff = client.get(f"/automations/{automation_id}/reassessment-diff").json()
    assert diff["business_context_changes"]

    history = client.get(f"/automations/{automation_id}/history").json()
    assert any("Business Context changed" in e["description"] for e in history)
