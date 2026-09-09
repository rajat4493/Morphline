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


def _create_workspace(client) -> int:
    r = client.post("/workspaces", json={"name": "Test Workspace"})
    assert r.status_code == 201
    return r.json()["id"]


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_upload_creates_automation_and_assessment(client):
    ws_id = _create_workspace(client)
    r = client.post(
        f"/workspaces/{ws_id}/uploads",
        data={"automation_name": "Customer Exclusion"},
        files={"file": ("customer_exclusion.zip", _zip_fixture("customer_exclusion"), "application/zip")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["assessment"]["recommendation"]["recommended_state"] == "HYBRID_AGENT"
    assert len(body["assessment"]["dimensions"]) == 13  # 12 risk/readiness dimensions + current_ai_usage (descriptive only)


def test_upload_rejects_disallowed_extension(client):
    ws_id = _create_workspace(client)
    r = client.post(
        f"/workspaces/{ws_id}/uploads",
        data={"automation_name": "Evil"},
        files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
    )
    assert r.status_code == 400


def test_flow_graph_and_overview_and_constraints(client):
    ws_id = _create_workspace(client)
    upload = client.post(
        f"/workspaces/{ws_id}/uploads",
        data={"automation_name": "Invoice"},
        files={"file": ("invoice_processing.zip", _zip_fixture("invoice_processing"), "application/zip")},
    ).json()
    automation_id = upload["automation_id"]

    overview = client.get(f"/automations/{automation_id}").json()
    assert overview["assessment"]["recommendation"]["recommended_state"] == "AUGMENTED_RPA"

    flow = client.get(f"/automations/{automation_id}/flow").json()
    assert flow["nodes"]
    assert flow["edges"]

    constraints = client.get(f"/automations/{automation_id}/constraints").json()
    assert any(c["category"] == "UNSTABLE_UI_DEPENDENCY" for c in constraints)


def test_migration_pack_downloads_zip(client):
    ws_id = _create_workspace(client)
    upload = client.post(
        f"/workspaces/{ws_id}/uploads",
        data={"automation_name": "Report"},
        files={"file": ("internal_report.zip", _zip_fixture("internal_report"), "application/zip")},
    ).json()
    automation_id = upload["automation_id"]

    r = client.post(f"/automations/{automation_id}/migration-pack")
    assert r.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())
    assert "target_architecture.md" in names
    assert "process_model.json" in names


def test_dashboard_aggregates_estate(client):
    ws_id = _create_workspace(client)
    for name in ("invoice_processing", "customer_exclusion", "internal_report"):
        client.post(
            f"/workspaces/{ws_id}/uploads",
            data={"automation_name": name},
            files={"file": (f"{name}.zip", _zip_fixture(name), "application/zip")},
        )
    dashboard = client.get(f"/workspaces/{ws_id}/dashboard").json()
    assert dashboard["estate"]["total_processes"] == 3
    assert sum(dashboard["estate"]["by_state"].values()) == 3


def test_reassessment_creates_new_assessment_and_preserves_history(client):
    ws_id = _create_workspace(client)
    upload = client.post(
        f"/workspaces/{ws_id}/uploads",
        data={"automation_name": "Invoice"},
        files={"file": ("invoice_processing.zip", _zip_fixture("invoice_processing"), "application/zip")},
    ).json()
    automation_id = upload["automation_id"]
    first_assessment_id = upload["assessment"]["id"]

    reupload = client.post(
        f"/workspaces/{ws_id}/uploads",
        data={"automation_id": automation_id},
        files={"file": ("invoice_processing_v2.zip", _zip_fixture("invoice_processing"), "application/zip")},
    ).json()
    second_assessment_id = reupload["assessment"]["id"]

    assert first_assessment_id != second_assessment_id
    assessments = client.get(f"/automations/{automation_id}/assessments").json()
    assert len(assessments) == 2

    diff = client.get(f"/automations/{automation_id}/reassessment-diff").json()
    assert "higher_level_possible" in diff


def test_target_architecture_and_platform_catalog_endpoints(client):
    ws_id = _create_workspace(client)
    catalog = client.get(f"/workspaces/{ws_id}/platform-catalog").json()
    assert any(p["role"] == "REASONING" for p in catalog)

    upload = client.post(
        f"/workspaces/{ws_id}/uploads",
        data={"automation_name": "Customer Exclusion"},
        files={"file": ("customer_exclusion.zip", _zip_fixture("customer_exclusion"), "application/zip")},
    ).json()
    automation_id = upload["automation_id"]

    plan = client.get(f"/automations/{automation_id}/target-architecture").json()
    assert plan["recommended_pattern"] == "HYBRID_WITH_HUMAN_APPROVAL"
    roles = {c["role"] for c in plan["components"]}
    assert "REASONING" in roles
    reasoning = next(c for c in plan["components"] if c["role"] == "REASONING")
    assert reasoning["platform"] == "AWS Bedrock"
    assert reasoning["manual_decision_required"] is False

    added = client.post(
        f"/workspaces/{ws_id}/platform-catalog",
        json={"name": "Azure OpenAI", "role": "REASONING"},
    )
    assert added.status_code == 201

    plan2 = client.get(f"/automations/{automation_id}/target-architecture").json()
    reasoning2 = next(c for c in plan2["components"] if c["role"] == "REASONING")
    assert reasoning2["manual_decision_required"] is True, "two REASONING platforms now registered — must not silently pick one"
    assert reasoning2["platform"] is None

    summary = client.get(f"/workspaces/{ws_id}/estate/architecture-summary").json()
    assert any(row["role"] == "REASONING" for row in summary)
