"""
Outcome tables: the "reality" a simulated tournament is played in.

A table is a TSV grid, one row per White player and one column per Black
player (the format claude-chess's personality/table_tsv.py writes):

    White \\ Black   Alice     Bob       Carol
    Alice           50/30/20  60/20/20  ...
    Bob             ...

Each cell is "White wins/Black wins/draws", either as game counts
(24/36/40) or as shares (0.24/0.36/0.4). The cell *is* the truth: a
simulated game between White i and Black j has exactly those outcome
probabilities. Tables for games without colours (dice, normal draws) are
simply symmetric.

Empty cells are filled from the colour-reversed cell when it exists, and
otherwise from a Bradley-Terry-with-draws fit to the whole table, so sparse
tables still work.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass, field

import numpy as np


@dataclass
class OutcomeTable:
    name: str
    players: list[str]
    p_white: np.ndarray  # [i, j] = P(White i beats Black j)
    p_black: np.ndarray  # [i, j] = P(Black j beats White i)
    p_draw: np.ndarray
    filled: np.ndarray = field(default=None)  # True where the cell came from data
    source: str = ""

    def __post_init__(self):
        if self.filled is None:
            self.filled = np.ones_like(self.p_white, dtype=bool)
        # Expected score for White in each pairing.
        self.e_white = self.p_white + 0.5 * self.p_draw
        # Colour-averaged expected score of i against j.
        self.e_avg = 0.5 * (self.e_white + (1.0 - self.e_white.T))

    @property
    def n(self) -> int:
        return len(self.players)

    def strength(self, field_idx=None) -> np.ndarray:
        """True strength of each player in a field: colour-averaged expected
        score against a uniformly chosen other member of the field. This is the
        reality a final ranking is scored against."""
        idx = np.arange(self.n) if field_idx is None else np.asarray(field_idx)
        sub = self.e_avg[np.ix_(idx, idx)]
        k = len(idx)
        return (sub.sum(axis=1) - np.diag(sub)) / (k - 1)

    def closeness(self, white: int, black: int) -> float:
        """Match quality of one game: 1 - |P(win) - P(loss)|. 1 for a coin flip
        (or a certain draw), 0 for a foregone conclusion."""
        return 1.0 - abs(self.p_white[white, black] - self.p_black[white, black])


def _parse_cell(text: str):
    text = text.strip()
    if not text:
        return None
    parts = text.split("/")
    if len(parts) != 3:
        raise ValueError(f"bad cell {text!r}: expected W/B/D")
    return [float(x) for x in parts]


def load_tsv(path: str, prior_games: float = 0.0, name: str | None = None) -> OutcomeTable:
    """Load a W/B/D grid.

    prior_games: pseudo-games added to every data cell, distributed like the
    whole table's W/B/D shares. 0 (default) takes the cells literally. Only
    meaningful for count cells; share cells are treated as one game.
    """
    with open(path, newline="") as f:
        rows = [r for r in csv.reader(f, delimiter="\t") if r and any(c.strip() for c in r)]
    header = rows[0][1:]
    players = [r[0] for r in rows[1:]]
    if header != players:
        raise ValueError(f"{path}: column players must match row players in the same order")
    n = len(players)
    counts = np.full((n, n, 3), np.nan)
    for i, r in enumerate(rows[1:]):
        cells = r[1:] + [""] * (n - len(r) + 1)
        for j in range(n):
            c = _parse_cell(cells[j])
            if c is not None and sum(c) > 0:
                counts[i, j] = c

    have = ~np.isnan(counts[..., 0])
    tot = np.where(have, counts.sum(axis=2), 1.0)
    shares = counts / tot[..., None]
    if prior_games > 0:
        g = np.nansum(counts.reshape(-1, 3), axis=0)
        base = g / g.sum()
        shares = (counts + prior_games * base) / (tot + prior_games)[..., None]

    p = np.where(have[..., None], shares, np.nan)
    filled = have.copy()
    # Fill from the colour-reversed cell: White j vs Black i -> swap win/loss.
    rev = np.transpose(p, (1, 0, 2))[..., [1, 0, 2]]
    use_rev = ~have & ~np.isnan(rev[..., 0])
    p[use_rev] = rev[use_rev]
    missing = np.isnan(p[..., 0])
    np.fill_diagonal(missing, False)
    if missing.any():
        p[missing] = _bt_fill(p, missing)
    for i in range(n):  # self-play cells are never used; keep them defined
        if np.isnan(p[i, i, 0]):
            p[i, i] = [0.5, 0.5, 0.0]
    return OutcomeTable(
        name=name or os.path.splitext(os.path.basename(path))[0],
        players=players,
        p_white=p[..., 0],
        p_black=p[..., 1],
        p_draw=p[..., 2],
        filled=filled,
        source=path,
    )


def _bt_fill(p: np.ndarray, missing: np.ndarray) -> np.ndarray:
    """Predict missing cells with a logistic strength model fitted to the
    colour-averaged scores that are known, keeping the table's draw rate."""
    n = p.shape[0]
    e = p[..., 0] + 0.5 * p[..., 2]
    known = ~np.isnan(e)
    np.fill_diagonal(known, False)
    draw_rate = np.nanmean(np.where(known, p[..., 2], np.nan))
    r = np.zeros(n)
    for _ in range(2000):
        pred = 1 / (1 + np.exp(-(r[:, None] - r[None, :])))
        g = np.where(known, e - pred, 0).sum(1) - np.where(known.T, e.T - (1 - pred.T), 0).sum(1)
        r += 0.05 * g / max(1, known.sum(1).max())
        r -= r.mean()
    ii, jj = np.nonzero(missing)
    pe = 1 / (1 + np.exp(-(r[ii] - r[jj])))
    d = np.full_like(pe, draw_rate)
    d = np.minimum(d, 2 * np.minimum(pe, 1 - pe))
    w = pe - d / 2
    return np.stack([w, 1 - w - d, d], axis=1)


def write_tsv(path: str, players: list[str], cells) -> None:
    """Write a W/B/D share grid. cells(i, j) -> (p_white, p_black, p_draw)."""
    with open(path, "w", newline="") as f:
        f.write("\t".join(["White \\ Black"] + players) + "\n")
        for i, w in enumerate(players):
            row = [w]
            for j in range(len(players)):
                row.append("/".join(_fmt(x) for x in cells(i, j)))
            f.write("\t".join(row) + "\n")


def _fmt(x: float) -> str:
    """Same style as claude-chess table_tsv.py --fraction: up to 4 decimals."""
    x = round(float(x), 4)
    return "0" if x == 0 else repr(x)
