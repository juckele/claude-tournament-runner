import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "src"), os.path.join(HERE, "..", "..", "..")]

import pytest  # noqa: E402

from engine import EngineError, handle, pair, rank  # noqa: E402


def snap(n, history=(), **fmt):
    ents = [{"id": f"e{i}", "seed": i + 1} for i in range(n)]
    return {"format": {"pairing": "swiss", "ranking": "score", "seed": 1, **fmt},
            "entrants": ents, "history": list(history)}


def test_round_one_swiss_folds_by_seed():
    s = snap(8)
    s.update(round=1, demand={f"e{i}": 1 for i in range(8)})
    out = pair(s)
    assert out["complete"]
    met = {frozenset(m) for m in out["matches"]}
    assert met == {frozenset({"e0", "e4"}), frozenset({"e1", "e5"}),
                   frozenset({"e2", "e6"}), frozenset({"e3", "e7"})}


def test_odd_field_leaves_one_unpaired():
    s = snap(5)
    s.update(round=1, demand={f"e{i}": 1 for i in range(5)})
    out = pair(s)
    assert len(out["matches"]) == 2 and out["complete"]
    assert list(out["unpaired"].values()) == [1]


def test_rematches_forbidden_and_forbidden_pairs():
    hist = [{"round": 1, "seats": ["e0", "e1"], "score": 1.0},
            {"round": 1, "seats": ["e2", "e3"], "score": 0.5}]
    s = snap(4, hist)
    s.update(round=2, demand={f"e{i}": 1 for i in range(4)}, forbidden=[["e0", "e2"]])
    out = pair(s)
    met = {frozenset(m) for m in out["matches"]}
    assert met == {frozenset({"e0", "e3"}), frozenset({"e1", "e2"})}


def test_impossible_pairing_is_incomplete():
    hist = [{"round": 1, "seats": ["e0", "e1"], "score": 1.0}]
    s = snap(2, hist)
    s.update(round=2, demand={"e0": 1, "e1": 1})
    assert not pair(s)["complete"]
    s["format"]["rematches"] = "allow"
    assert pair(s)["complete"]


def test_seat_order_irrelevant_sorts_seats():
    s = snap(4)
    s.update(round=1, demand={f"e{i}": 1 for i in range(4)}, seat_order="irrelevant")
    for m in pair(s)["matches"]:
        assert m == sorted(m)


def test_rank_by_score_with_extra_points():
    hist = [{"round": 1, "seats": ["e0", "e1"], "score": 0.0},
            {"round": 1, "seats": ["e2"], "bye": True}]
    s = snap(3, hist)
    s["extra_points"] = {"e2": 1.0}
    out = rank(s)
    assert out["order"][-1] == "e0"
    assert set(out["order"][:2]) == {"e1", "e2"}


def test_rank_bt_returns_ratings():
    hist = [{"round": 1, "seats": ["e0", "e1"], "score": 1.0},
            {"round": 2, "seats": ["e1", "e2"], "score": 1.0}]
    out = rank({**snap(3, hist, ranking="bt")})
    assert out["order"] == ["e0", "e1", "e2"]
    assert out["ratings"]["e0"] > out["ratings"]["e2"]


@pytest.mark.parametrize("name", ["rank-bt", "info-bt-50", "monrad", "elo-match"])
def test_other_pairers_run(name):
    hist = [{"round": 1, "seats": [f"e{2*i}", f"e{2*i+1}"], "score": 1.0} for i in range(4)]
    s = snap(8, hist, pairing=name)
    s.update(round=2, demand={f"e{i}": 1 for i in range(8)})
    out = pair(s)
    assert out["complete"] and len(out["matches"]) == 4


def test_handle_errors():
    assert handle("/pair", {**snap(2, pairing="nope"), "round": 1})[0] == 422
    assert handle("/pair", {})[0] == 400
    assert handle("/nope", {})[0] == 404
    assert "swiss" in handle("/systems", {})[1]["pairing"]
