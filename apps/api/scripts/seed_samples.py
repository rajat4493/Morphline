"""Seeds the local database with the three synthetic sample fixtures
(Section 20) into a "Sample Workspace" so the app has something to look at
on first run. Safe to re-run — skips automations that already exist.

Usage (from repo root, with the venv active):
    python -m apps.api.scripts.seed_samples
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from apps.api.app.db import Base, SessionLocal, engine
from apps.api.app.models import orm
from apps.api.app.pipeline import process_upload_and_assess

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES_DIR = REPO_ROOT / "fixtures" / "uipath"

SAMPLES = {
    "invoice_processing": "Invoice Processing (Sample)",
    "customer_exclusion": "Customer Exclusion Review (Sample)",
    "internal_report": "Internal Report Generation (Sample)",
}


def _zip_fixture(fixture_dir: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in fixture_dir.rglob("*"):
            if f.is_file():
                zf.write(f, arcname=f.relative_to(fixture_dir))
    return buf.getvalue()


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        workspace = db.query(orm.Workspace).filter_by(name="Sample Workspace").first()
        if not workspace:
            workspace = orm.Workspace(name="Sample Workspace")
            db.add(workspace)
            db.flush()

        for fixture_key, automation_name in SAMPLES.items():
            existing = db.query(orm.Automation).filter_by(workspace_id=workspace.id, name=automation_name).first()
            if existing:
                print(f"skip (already seeded): {automation_name}")
                continue
            automation = orm.Automation(workspace_id=workspace.id, name=automation_name, is_sample=True)
            db.add(automation)
            db.flush()
            data = _zip_fixture(FIXTURES_DIR / fixture_key)
            assessment = process_upload_and_assess(db, automation, f"{fixture_key}.zip", data)
            print(f"seeded: {automation_name} -> assessment #{assessment.id}, recommended={assessment.recommendation.recommended_state}")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
