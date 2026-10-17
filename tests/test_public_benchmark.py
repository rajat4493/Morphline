"""Integrity tests for the public held-out benchmark. They never need the
third-party cache: they validate the committed manifest, frozen blind results
and provisional labels."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "benchmark"
manifest = json.loads((ROOT / "public_manifest.json").read_text())["projects"]
blind = json.loads((ROOT / "results" / "public-heldout-blind-v1.json").read_text())
labels = json.loads((ROOT / "labels" / "public-heldout-v1.json").read_text())["labels"]


def test_manifest_pins_and_blocks_vendoring():
    assert len(manifest) == 10
    for p in manifest:
        assert len(p["pinned_commit"]) == 40 and p["vendored_in_git"] is False
        assert p["used_in_product_development"] is False
        assert "expected" not in json.dumps(p).lower()  # no labels in the manifest


def test_blind_results_cover_every_project_and_keep_failures_visible():
    ids = {r["benchmark_id"] for r in blind["results"]}
    assert ids == {p["benchmark_id"] for p in manifest}
    for r in blind["results"]:
        assert r["parser_outcome"] in {"PARSED", "PARSER_FAILED"}
        assert {p["benchmark_id"]: p for p in manifest}[r["benchmark_id"]]["pinned_commit"] == r["source_commit"]


def test_labels_are_provisional_with_unknown_safety_and_expert_slots():
    for l in labels:
        assert l["label_status"] == "provisional_expert_label"
        assert all(v == "UNKNOWN" for v in l["enterprise_safety"].values())
        assert set(l["independent_experts"]) >= {"expert_1", "expert_2", "expert_3", "consensus_label", "adjudicated_by"}


def test_blind_results_file_is_immutable_by_runner(tmp_path):
    import pytest
    from benchmark.public import blind_run
    with pytest.raises(SystemExit):
        import sys
        sys.argv = ["x", "--out", "public-heldout-blind-v1.json"]
        blind_run.main()
