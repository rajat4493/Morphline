from benchmark.run import evaluate


def test_morphline_never_exceeds_expert_safety_ceiling_and_beats_naive_baselines():
    res = evaluate()
    m = res["morphline"]
    assert m["unsafe_rate"] == 0
    for name, b in res.items():
        if name != "morphline":
            assert m["accuracy"] >= b["accuracy"] and m["unsafe_rate"] <= b["unsafe_rate"]
