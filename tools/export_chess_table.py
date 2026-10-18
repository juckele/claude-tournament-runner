#!/usr/bin/env python3
"""
Export the claude-chess personality match table as a White x Black TSV grid.

Reads (never writes) a checkout of juckele/claude-chess and reproduces the
format of its personality/table_tsv.py: one row per White player, one column
per Black player, each cell "White wins/Black wins/draws" over finished
batches. Pending and abandoned claims don't count.

    python3 tools/export_chess_table.py ../claude-chess/results/match-table.json \
        data/chess-personality.tsv

This is a standalone re-implementation so it doesn't need python-chess or
Stockfish installed (table_tsv.py imports the engine module).
"""

import argparse
import json


def is_done(batch):
    return batch.get("status", "done") == "done"


def tally(table):
    out = {}
    for bt in filter(is_done, table["batches"]):
        c = out.setdefault((bt["white"], bt["black"]), [0, 0, 0])
        c[0] += bt["white_wins"]
        c[1] += bt["black_wins"]
        c[2] += bt["draws"]
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("match_table", help="claude-chess results/match-table.json")
    p.add_argument("output", help="TSV file to write")
    args = p.parse_args()

    with open(args.match_table) as f:
        table = json.load(f)
    players = list(table["players"])
    results = tally(table)
    with open(args.output, "w", newline="") as f:
        f.write("\t".join(["White \\ Black"] + players) + "\n")
        for w in players:
            cells = []
            for b in players:
                c = results.get((w, b))
                cells.append("" if not c or sum(c) == 0 else "/".join(map(str, c)))
            f.write("\t".join([w] + cells) + "\n")
    filled = sum(1 for c in results.values() if sum(c))
    games = sum(sum(c) for c in results.values())
    print(f"wrote {args.output}: {len(players)} x {len(players)} players, "
          f"{filled} pairings, {games} games")


if __name__ == "__main__":
    main()
