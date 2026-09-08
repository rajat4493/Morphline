import json
from pathlib import Path

from packages.shared.canonical import ProcessModel
from parser.uipath.parse import parse_project

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uipath"


def test_process_model_round_trips_through_json():
    pm = parse_project(FIXTURES / "customer_exclusion", "zip")
    raw = pm.model_dump_json()
    restored = ProcessModel.model_validate(json.loads(raw))
    assert restored == pm


def test_process_model_tolerates_missing_optional_fields():
    minimal = json.loads(ProcessModel(project_name="X").model_dump_json())
    del minimal["parser_warnings"]
    restored = ProcessModel.model_validate(minimal)
    assert restored.parser_warnings == []
