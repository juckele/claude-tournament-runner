import collections
import json

import numpy as np
import pytest

from pairlab import league


def make(n=13, **kw):
    names = [f"p{i:02d}" for i in range(n)]
    return league.stub(names, name="T", seed=7, **kw)


def play_week(d, week, rng, skip=()):
    for m in d["matches"]:
        if m["week"] == week and m["winner"] == "pending" and m["id"] not in skip:
            m["winner"] = rng.choice([m["white"], m["black"], "draw"])


def run_league(d, skip=(), withdraw=None):
    rng = np.random.default_rng(0)
    emails = []
    for wk in range(1, d["tournament"]["weeks"] + 2):
        emails.append(league.advance(d))
        if d["tournament"]["status"] == "complete":
            break
        play_week(d, wk, rng, skip)
        if withdraw and wk == withdraw[1]:
            for p in d["players"]:
                if p["username"] == withdraw[0]:
                    p["withdrawn"] = True
    return emails


def test_stub_is_valid_and_round_trips(tmp_path):
    d = make()
    league.validate(d)
    f = tmp_path / "l.json"
    league.save(str(f), d)
    assert league.load(str(f)) == json.loads(json.dumps(d))
    assert league.main(["init", str(f), "--players", "a"]) == 1  # refuses to overwrite


def test_full_league_respects_every_rule():
    d = make()
    d["players"][1]["byes"] = [2]
    d["players"][2]["max_games_per_week"] = 1
    d["players"][3]["byes"] = [3, 4]
    run_league(d, withdraw=("p12", 2))
    P = {p["username"]: p for p in d["players"]}
    ms = [m for m in d["matches"] if m["winner"] != "void"]
    pairs = collections.Counter(frozenset((m["white"], m["black"])) for m in ms)
    assert max(pairs.values()) == 1
    per, tot = collections.Counter(), collections.Counter()
    for m in ms:
        for u in (m["white"], m["black"]):
            per[(u, m["week"])] += 1
            tot[u] += 1
    for (u, w), c in per.items():
        assert c <= P[u]["max_games_per_week"]
        assert w not in P[u]["byes"]
    assert all(m["week"] <= P["p12"]["withdrawn_week"] for m in ms
               if "p12" in (m["white"], m["black"]))
    gmax = d["tournament"]["games_target"]["max"]
    assert max(tot.values()) <= gmax
    unconstrained = [u for u in P if u not in ("p01", "p02", "p03", "p12")]
    assert all(tot[u] >= d["tournament"]["games_target"]["min"] - 1 for u in unconstrained)
    assert d["tournament"]["status"] == "complete"
    with pytest.raises(league.LeagueError):
        league.advance(d)


def test_pairings_are_reproducible():
    a, b = make(), make()
    run_league(a)
    run_league(b)
    assert a["matches"] == b["matches"]


def test_unreported_games_block_eligibility_and_are_called_out():
    d = make(8)
    league.advance(d)
    first = d["matches"][0]
    league.advance(d)  # week 1 closes with nothing reported
    s = d["standings"]
    blocked = {r["username"] for r in s["all"] if not r["eligible"]}
    assert {first["white"], first["black"]} <= blocked
    d2 = make(8)
    league.advance(d2)
    play_week(d2, 1, np.random.default_rng(1), skip={d2["matches"][0]["id"]})
    text = league.advance(d2)
    assert "Unreported games (1)" in text and d2["matches"][0]["id"] in text


def test_withdrawals_are_anonymous_and_void_games():
    d = make(8)
    league.advance(d)
    gone = d["matches"][0]["white"]
    for p in d["players"]:
        if p["username"] == gone:
            p["withdrawn"] = True
    text = league.advance(d)
    assert gone not in text
    assert "1 player has withdrawn" in text
    assert all(m["winner"] == "void" for m in d["matches"]
               if gone in (m["white"], m["black"]) and m["week"] == 1)


def test_final_standings_need_min_games():
    d = make(6, min_games_to_rank=50)
    d["tournament"]["games_target"] = {"min": 2, "max": 3}
    run_league(d)
    assert d["standings"]["final"] and d["standings"]["eligible"] == []


@pytest.mark.parametrize("bad, msg", [
    (lambda d: d["matches"].append({"id": "x", "week": 1, "white": "p00", "black": "zed",
                                    "winner": "pending"}), "unknown player"),
    (lambda d: d["matches"].append({"id": "x", "week": 1, "white": "p00", "black": "p01",
                                    "winner": "p05"}), "winner"),
    (lambda d: d["players"].append(dict(d["players"][0])), "duplicate usernames"),
    (lambda d: d["tournament"].update(pairing="round-robin"), "pairing"),
    (lambda d: d["players"][0].update(byes=[9]), "byes"),
])
def test_validation_errors(bad, msg):
    d = make(4)
    d["tournament"]["current_week"] = 1
    bad(d)
    with pytest.raises(league.LeagueError, match=msg):
        league.validate(d)


@pytest.mark.parametrize("pairing", ["swiss", "rank-bt", "elo-match", "nd-info", "monrad"])
def test_supported_pairers_run(pairing):
    d = make(9, pairing=pairing)
    run_league(d)
    assert d["tournament"]["status"] == "complete"
