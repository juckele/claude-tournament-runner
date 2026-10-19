"""
Run a real league from a JSON file kept in version control.

Players register, report results and withdraw by editing their own entries;
the organiser runs `advance` once a week, which pairs the new week, updates
the standings and writes an announcement email in Markdown.

    python3 -m pairlab.league init league.json --players alice bob carol dave
    python3 -m pairlab.league validate league.json
    python3 -m pairlab.league standings league.json
    python3 -m pairlab.league advance league.json --email week-1.md

File format (keys starting with "_" are notes for humans and are ignored):

    {
      "tournament": {
        "name": "Autumn League",
        "weeks": 4,                          # length of the group phase
        "games_target": {"min": 8, "max": 9},  # total games per player
        "current_week": 0,                   # 0 = not started; set by `advance`
        "status": "registration",            # registration | running | complete
        "pairing": "rank-bt",                # any pairer in pairlab.pairers (see SUPPORTED)
        "ranking": "bt",                     # any ranker in pairlab.rankers
        "min_games_to_rank": 6,              # needed to appear in the final rankings
        "bracket_size": 8,                   # players who advance to the bracket
        "seed": 12345                        # makes pairings reproducible
      },
      "players": [
        {"username": "alice", "byes": [3], "max_games_per_week": 3, "withdrawn": false}
      ],
      "matches": [
        {"id": "w1-01", "week": 1, "white": "alice", "black": "bob", "winner": "pending"}
      ],
      "standings": { ... written by the script ... },
      "log": [ ... one entry per week, written by the script ... ]
    }

`winner` is a username, "draw", "pending" (not played yet) or "void" (set by
the script when a game can't be played because a player withdrew).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import zlib

import numpy as np

from .pairers import PAIRERS, make_pairer
from .rankers import RANKERS, RATINGS, bradley_terry
from .tournament import State, plan_batch

# Pairers that can be rebuilt from the file alone. Round robin keeps a fixed
# schedule across weeks and the oracles need the true strengths.
SUPPORTED = [p for p in PAIRERS if p != "round-robin" and not p.startswith("oracle")]
DEFAULTS = {
    "weeks": 4, "games_target": {"min": 8, "max": 9}, "pairing": "rank-bt", "ranking": "bt",
    "min_games_to_rank": 6, "bracket_size": 8, "max_games_per_week": 3,
}
HELP = {
    "tournament": "Organiser settings. current_week and status are maintained by the script.",
    "players": ("Register by adding {\"username\": ..., \"byes\": [weeks you can't play], "
                "\"max_games_per_week\": N, \"withdrawn\": false}. To withdraw, set withdrawn "
                "to true; your unplayed games become void."),
    "matches": ("Report a result by changing \"winner\" from \"pending\" to the winner's "
                "username, or to \"draw\". Don't change anything else."),
    "standings": "Written by the script; edits are overwritten.",
}


class LeagueError(Exception):
    pass


# ------------------------------------------------------------------- file I/O
def load(path):
    with open(path) as f:
        return json.load(f)


def save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def stub(names, name="League", seed=None, **settings):
    t = {"name": name, "weeks": DEFAULTS["weeks"], "games_target": dict(DEFAULTS["games_target"]),
         "current_week": 0, "status": "registration", "pairing": DEFAULTS["pairing"],
         "ranking": DEFAULTS["ranking"], "min_games_to_rank": DEFAULTS["min_games_to_rank"],
         "bracket_size": DEFAULTS["bracket_size"],
         "seed": int(seed if seed is not None else np.random.SeedSequence().entropy % 2**31)}
    per_week = settings.pop("max_games_per_week", DEFAULTS["max_games_per_week"])
    t.update({k: v for k, v in settings.items() if v is not None})
    players = [{"username": u, "byes": [], "max_games_per_week": per_week, "withdrawn": False}
               for u in names]
    return {"_help": HELP, "tournament": t, "players": players, "matches": [],
            "standings": {}, "log": []}


# ------------------------------------------------------------------ validation
def validate(data):
    """Raise LeagueError listing every problem found."""
    errs = []
    t = data.get("tournament")
    if not isinstance(t, dict):
        raise LeagueError("missing \"tournament\" object")
    for k in ("weeks", "games_target", "current_week", "pairing", "ranking",
              "min_games_to_rank", "bracket_size", "seed"):
        if k not in t:
            errs.append(f"tournament.{k} is missing")
    if errs:
        raise LeagueError("\n".join(errs))
    W = t["weeks"]
    if not (isinstance(W, int) and W >= 1):
        errs.append("tournament.weeks must be a positive integer")
    gt = t["games_target"]
    if not (isinstance(gt, dict) and isinstance(gt.get("min"), int) and isinstance(gt.get("max"), int)
            and 0 < gt["min"] <= gt["max"]):
        errs.append("tournament.games_target must be {\"min\": a, \"max\": b} with 0 < a <= b")
    if t["pairing"] not in SUPPORTED:
        errs.append(f"tournament.pairing {t['pairing']!r} is not one of: {', '.join(SUPPORTED)}")
    if t["ranking"] not in RANKERS:
        errs.append(f"tournament.ranking {t['ranking']!r} is not one of: {', '.join(RANKERS)}")
    cw = t["current_week"]
    if not (isinstance(cw, int) and 0 <= cw <= W):
        errs.append(f"tournament.current_week must be between 0 and {W}")

    names = []
    for i, p in enumerate(data.get("players", [])):
        u = p.get("username")
        where = f"players[{i}] ({u})" if u else f"players[{i}]"
        if not isinstance(u, str) or not u.strip():
            errs.append(f"{where}: username must be a non-empty string")
            continue
        if u in ("draw", "pending", "void"):
            errs.append(f"{where}: {u!r} is reserved")
        names.append(u)
        byes = p.get("byes", [])
        if not (isinstance(byes, list) and all(isinstance(b, int) and 1 <= b <= W for b in byes)):
            errs.append(f"{where}: byes must be a list of week numbers 1-{W}")
        mg = p.get("max_games_per_week")
        if not (isinstance(mg, int) and mg >= 0):
            errs.append(f"{where}: max_games_per_week must be a whole number >= 0")
        if not isinstance(p.get("withdrawn", False), bool):
            errs.append(f"{where}: withdrawn must be true or false")
    dup = {u for u in names if names.count(u) > 1}
    if dup:
        errs.append(f"duplicate usernames: {', '.join(sorted(dup))}")

    known = set(names)
    ids = []
    for i, m in enumerate(data.get("matches", [])):
        where = f"matches[{i}] ({m.get('id', '?')})"
        ids.append(m.get("id"))
        a, b, w = m.get("white"), m.get("black"), m.get("winner")
        for side in (a, b):
            if side not in known:
                errs.append(f"{where}: unknown player {side!r}")
        if a == b:
            errs.append(f"{where}: a player can't play themselves")
        if w not in (a, b, "draw", "pending", "void"):
            errs.append(f"{where}: winner {w!r} must be {a!r}, {b!r}, \"draw\" or \"pending\"")
        if not (isinstance(m.get("week"), int) and 1 <= m["week"] <= max(cw, 1)):
            errs.append(f"{where}: week must be between 1 and the current week")
    dup = {x for x in ids if ids.count(x) > 1}
    if dup:
        errs.append(f"duplicate match ids: {', '.join(sorted(map(str, dup)))}")
    if errs:
        raise LeagueError("\n".join(errs))


# ------------------------------------------------------------------ state
def _score(m):
    """White's score, or None if the game has no result."""
    w = m["winner"]
    if w == m["white"]:
        return 1.0
    if w == m["black"]:
        return 0.0
    if w == "draw":
        return 0.5
    return None


def _seed_rank(data):
    """No rating seeds: a fixed random order per tournament, stable when players join."""
    seed = data["tournament"]["seed"]
    names = [p["username"] for p in data["players"]]
    keys = [zlib.crc32(f"{seed}|{u}".encode()) for u in names]
    order = np.argsort(keys, kind="stable")
    rank = np.empty(len(names), dtype=int)
    rank[order] = np.arange(len(names))
    return rank


def _per_week(data):
    gt = data["tournament"]["games_target"]
    return max(1.0, (gt["min"] + gt["max"]) / 2 / data["tournament"]["weeks"])


def build_state(data, upto_week, pairer=None, rng=None):
    """State with every match from weeks < upto_week, replayed week by week
    through the pairer (if given) exactly as the simulator would: colours and
    meetings from all scheduled games, results from reported ones."""
    t = data["tournament"]
    names = [p["username"] for p in data["players"]]
    idx = {u: i for i, u in enumerate(names)}
    n = len(names)
    st = State(n, _seed_rank(data), t["weeks"], bye_points=0.0)
    st.games_per_batch = _per_week(data)
    for entry in data.get("log", []):
        for u in entry.get("unpaired", []):
            if u in idx:
                st.byes[idx[u]] += 1
    if pairer is not None:
        pairer.start(st, rng)
    for wk in range(1, upto_week):
        st.batch = wk - 1
        for m in data["matches"]:
            if m["week"] != wk or m["winner"] == "void":
                continue
            w, b = idx[m["white"]], idx[m["black"]]
            st.whites[w] += 1
            st.blacks[b] += 1
            st.last_color[w], st.last_color[b] = 1, -1
            st.opp[w, b] += 1
            st.opp[b, w] += 1
            r = _score(m)
            if r is not None:
                st.games.append((w, b, r, wk - 1))
                st.game_points[w] += r
                st.game_points[b] += 1 - r
                st.score[w] += r
                st.score[b] += 1 - r
                st.played[w] += 1
                st.played[b] += 1
        if pairer is not None:
            pairer.end_batch(st, rng)
    st.batch = upto_week - 1
    return st, names, idx


def _scheduled(data, u):
    return sum(1 for m in data["matches"] if m["winner"] != "void" and u in (m["white"], m["black"]))


def week_demand(data, week):
    """Games each player should get this week: an even spread of the remaining
    target over the weeks they can still play, capped by their own weekly limit
    and by the target maximum."""
    t = data["tournament"]
    gmin, gmax = t["games_target"]["min"], t["games_target"]["max"]
    out = []
    for p in data["players"]:
        if p.get("withdrawn") or week in p.get("byes", []):
            out.append(0)
            continue
        sched = _scheduled(data, p["username"])
        weeks_left = sum(1 for w in range(week, t["weeks"] + 1) if w not in p.get("byes", []))
        want = max(math.ceil((gmin - sched) / weeks_left), (gmax - sched) // weeks_left)
        out.append(max(0, min(p["max_games_per_week"], gmax - sched, want)))
    return np.array(out, dtype=int)


# ------------------------------------------------------------------ standings
def compute_standings(data):
    t = data["tournament"]
    cw = t["current_week"]
    complete = t.get("status") == "complete"
    st, names, idx = build_state(data, t["weeks"] + 2)  # every reported game
    order = RANKERS[t["ranking"]](st, np.random.default_rng([t["seed"], 999]))
    rating = None
    if t["ranking"] == "bt":
        rating = 1500 + 400 / math.log(10) * bradley_terry(st)
    elif t["ranking"] in RATINGS:
        rating = RATINGS[t["ranking"]](st)
    gmax = t["games_target"]["max"]
    rows = []
    for pos, i in enumerate(order, 1):
        p = data["players"][i]
        u = p["username"]
        mine = [m for m in data["matches"] if u in (m["white"], m["black"]) and m["winner"] != "void"]
        wins = sum(1 for m in mine if m["winner"] == u)
        draws = sum(1 for m in mine if m["winner"] == "draw")
        played = int(st.played[i])
        overdue = sorted({m["week"] for m in mine if m["winner"] == "pending"
                          and (m["week"] < cw or complete)})
        this_week = sum(1 for m in mine if m["winner"] == "pending" and m["week"] == cw
                        and not complete)
        future = 0
        if not complete:
            room = gmax - len(mine)
            for w in range(cw + 1, t["weeks"] + 1):
                if w not in p.get("byes", []):
                    future += p["max_games_per_week"]
            future = max(0, min(future, room))
        reachable = played + this_week + future
        if p.get("withdrawn"):
            reason = "withdrawn"
        elif overdue:
            reason = "unreported game(s) from week " + ", ".join(map(str, overdue))
        elif reachable < t["min_games_to_rank"]:
            reason = (f"has {played} game(s); needs {t['min_games_to_rank']}" if complete else
                      f"can reach at most {reachable} of the {t['min_games_to_rank']} games needed")
        else:
            reason = None
        row = {"rank": pos, "username": u, "played": played, "wins": wins, "draws": draws,
               "losses": played - wins - draws, "points": wins + 0.5 * draws,
               "scheduled": len(mine), "eligible": reason is None}
        if rating is not None:
            row["rating"] = round(float(rating[i]), 1 if t["ranking"] == "bt" else 4)
        if reason:
            row["not_eligible_because"] = reason
        rows.append(row)
    eligible = [r["username"] for r in rows if r["eligible"]]
    return {"after_week": cw, "ranking": t["ranking"], "final": complete,
            "eligible": eligible, "bracket": eligible[:t["bracket_size"]], "all": rows}


# ------------------------------------------------------------------ advance
def advance(data):
    """Close the current week and open the next (or finish the group phase).
    Mutates `data`; returns the announcement email (Markdown)."""
    validate(data)
    t = data["tournament"]
    if t.get("status") == "complete":
        raise LeagueError("the group phase is already complete")
    if len(data["players"]) < 2:
        raise LeagueError("need at least two registered players")
    old = t["current_week"]

    # Withdrawals noticed since the last run: stamp them and void their unplayed games.
    new_drops = [p for p in data["players"] if p.get("withdrawn") and "withdrawn_week" not in p]
    for p in new_drops:
        p["withdrawn_week"] = old
    gone = {p["username"] for p in data["players"] if p.get("withdrawn")}
    voided = 0
    for m in data["matches"]:
        if m["winner"] == "pending" and (m["white"] in gone or m["black"] in gone):
            m["winner"] = "void"
            voided += 1

    overdue = [m for m in data["matches"] if m["winner"] == "pending" and m["week"] <= old]
    week = old + 1
    entry = {"week": week, "withdrawals": len(new_drops), "voided": voided}
    pairs, sitting = [], {}
    if week > t["weeks"]:
        t["status"] = "complete"
        entry["week"] = old
        entry["closed"] = True
    else:
        t["current_week"] = week
        t["status"] = "running"
        rng = np.random.default_rng([t["seed"], week])
        pairer = make_pairer(t["pairing"])
        st, names, idx = build_state(data, week, pairer, rng)
        demand = week_demand(data, week)
        batch, unmet = plan_batch(st, pairer, demand, rng)
        for k, (w, b) in enumerate(batch, 1):
            m = {"id": f"w{week}-{k:02d}", "week": week, "white": names[w], "black": names[b],
                 "winner": "pending"}
            data["matches"].append(m)
            pairs.append(m)
        for i, p in enumerate(data["players"]):
            if p.get("withdrawn"):
                continue
            if week in p.get("byes", []):
                sitting[p["username"]] = "bye requested"
            elif unmet[i] > 0:
                got = demand[i] - unmet[i]
                sitting[p["username"]] = (f"{got} of {demand[i]} games: no eligible opponent left"
                                          if got else "no eligible opponent this week")
            elif demand[i] == 0:
                sitting[p["username"]] = "game target reached" if p["max_games_per_week"] else \
                    "weekly limit is 0"
        entry["games"] = len(pairs)
        entry["unpaired"] = [u for u, why in sitting.items() if "opponent" in why]
    data.setdefault("log", []).append(entry)
    data["standings"] = compute_standings(data)
    return email(data, pairs, overdue, len(new_drops), voided, sitting)


# ------------------------------------------------------------------ email
def _leaderboard(data, s):
    t = data["tournament"]
    rows = [r for r in s["all"] if r["username"] not in
            {p["username"] for p in data["players"] if p.get("withdrawn")}]
    if not any(r["played"] for r in rows):
        return ["No results reported yet."]
    has_rating = any("rating" in r for r in rows)
    head = "| # | Player | Played | W-D-L |" + (" Rating |" if has_rating else "")
    out = [head, "|" + "---|" * (head.count("|") - 1)]
    eligible = [r for r in rows if r["eligible"]]
    for k, r in enumerate(eligible, 1):
        line = (f"| {k} | {r['username']} | {r['played']} | "
                f"{r['wins']}-{r['draws']}-{r['losses']} |")
        if has_rating:
            line += f" {r.get('rating', '')} |"
        out.append(line)
        if k == t["bracket_size"] and len(eligible) > k:
            out.append("| | *bracket cut* | | |" + (" |" if has_rating else ""))
    others = [r for r in rows if not r["eligible"]]
    if others:
        out += ["", "Not eligible for the final rankings:" if s["final"] else
                "Not currently eligible for the final rankings:", ""]
        out += [f"- {r['username']} ({r['played']} played): {r['not_eligible_because']}"
                for r in others]
    return out


def email(data, pairs, overdue, drops, voided, sitting):
    t = data["tournament"]
    s = data["standings"]
    final = t.get("status") == "complete"
    lines = []
    if final:
        lines += [f"# {t['name']}: group phase complete", ""]
    else:
        lines += [f"# {t['name']}: week {t['current_week']} of {t['weeks']}", ""]
        lines += [f"## This week's games ({len(pairs)})", ""]
        if pairs:
            lines += ["| Game | White | Black |", "|---|---|---|"]
            lines += [f"| {m['id']} | {m['white']} | {m['black']} |" for m in pairs]
            lines += ["", "Report a result by setting `winner` on your game in the league file "
                      "to the winner's username (or `draw`)."]
        else:
            lines += ["No games could be scheduled this week."]
        lines.append("")
        if sitting:
            lines += ["Not playing every requested game this week:", ""]
            lines += [f"- {u}: {why}" for u, why in sitting.items()]
            lines.append("")
    if overdue:
        lines += [f"## Unreported games ({len(overdue)})", "",
                  "These games are overdue. Players with unreported games can't qualify for "
                  "the bracket until they're reported" +
                  (" and the organiser reruns the standings." if final else "."), ""]
        lines += [f"- {m['id']} (week {m['week']}): {m['white']} vs {m['black']}"
                  for m in sorted(overdue, key=lambda m: (m["week"], m["id"]))]
        lines.append("")
    if drops:
        lines += ["## Roster changes", "",
                  f"{drops} player{'s have' if drops > 1 else ' has'} withdrawn since the last "
                  "update." + (f" {voided} unplayed game{'s were' if voided != 1 else ' was'} "
                               "cancelled as a result." if voided else ""), ""]
    title = "Final standings" if final else "Leaderboard"
    lines += [f"## {title} (top {t['bracket_size']} advance to the bracket)", ""]
    lines += _leaderboard(data, s)
    if final:
        lines += ["", "Advancing to the bracket: " + (", ".join(s["bracket"]) or "nobody")]
    lines += ["", f"_Ranked by {t['ranking']}; at least {t['min_games_to_rank']} games and no "
              "unreported games are needed to qualify._", ""]
    return "\n".join(lines)


# ------------------------------------------------------------------ CLI
def main(argv=None):
    ap = argparse.ArgumentParser(prog="python3 -m pairlab.league",
                                 description="Run a league from a JSON file.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init", help="write a new league file with defaults")
    i.add_argument("file")
    i.add_argument("--players", nargs="*", default=[], help="usernames to register")
    i.add_argument("--name", default="League")
    i.add_argument("--weeks", type=int)
    i.add_argument("--games", help="target games per player, e.g. 8-9")
    i.add_argument("--min-games", type=int, dest="min_games_to_rank")
    i.add_argument("--bracket", type=int, dest="bracket_size")
    i.add_argument("--pairing", choices=SUPPORTED)
    i.add_argument("--ranking", choices=list(RANKERS))
    i.add_argument("--max-per-week", type=int, default=DEFAULTS["max_games_per_week"])
    i.add_argument("--seed", type=int)
    i.add_argument("--force", action="store_true", help="overwrite an existing file")
    for name, hlp in (("validate", "check the file"),
                      ("standings", "recompute standings and print the leaderboard"),
                      ("advance", "close this week, pair the next, write the email")):
        c = sub.add_parser(name, help=hlp)
        c.add_argument("file")
        if name == "advance":
            c.add_argument("--email", help="write the email here (default: print it)")
            c.add_argument("--dry-run", action="store_true",
                           help="print the email without changing the file")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "init":
            if os.path.exists(a.file) and not a.force:
                raise LeagueError(f"{a.file} exists (use --force to overwrite)")
            settings = {"weeks": a.weeks, "min_games_to_rank": a.min_games_to_rank,
                        "bracket_size": a.bracket_size, "pairing": a.pairing,
                        "ranking": a.ranking, "max_games_per_week": a.max_per_week}
            if a.games:
                lo, _, hi = a.games.partition("-")
                settings["games_target"] = {"min": int(lo), "max": int(hi or lo)}
            data = stub(a.players, name=a.name, seed=a.seed, **settings)
            validate(data)
            save(a.file, data)
            print(f"wrote {a.file}: {len(a.players)} player(s); edit settings, then run advance")
        elif a.cmd == "validate":
            validate(load(a.file))
            print("ok")
        elif a.cmd == "standings":
            data = load(a.file)
            validate(data)
            data["standings"] = compute_standings(data)
            save(a.file, data)
            print("\n".join(_leaderboard(data, data["standings"])))
        else:
            data = load(a.file)
            text = advance(data)
            if not a.dry_run:
                save(a.file, data)
            if a.email and not a.dry_run:
                with open(a.email, "w") as f:
                    f.write(text)
                print(f"wrote {a.email}; {a.file} is now at week "
                      f"{data['tournament']['current_week']} ({data['tournament']['status']})")
            else:
                print(text)
    except LeagueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
