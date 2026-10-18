"""
The two axes.

Match quality: how close the group phase's games are. A game's closeness is
1 - |P(win) - P(loss)| from the table's true probabilities, so it measures
the pairing, not the luck of the result. 1 = a coin flip (or a certain
draw), 0 = a foregone conclusion. A tournament's match quality is the mean
over its games.

Ranking quality: how well the final order matches reality. Reality is each
player's true strength in this field (colour-averaged expected score against
the other entrants, see OutcomeTable.strength). The headline number is
Kendall's tau-b between the final order and true strength (1 = perfect,
0 = no better than a random order). Spearman's rho, top-quarter precision and
"the strongest player won" are reported alongside.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import kendalltau, spearmanr


def ranking_quality(order: np.ndarray, strength: np.ndarray) -> dict:
    n = len(order)
    pos = np.empty(n)
    pos[order] = np.arange(n)
    tau = kendalltau(-pos, strength).statistic
    rho = spearmanr(-pos, strength).statistic
    k = max(1, n // 4)
    true_top = set(np.argsort(-strength, kind="stable")[:k].tolist())
    topq = len(true_top & set(order[:k].tolist())) / k
    win = float(strength[order[0]] >= strength.max() - 1e-12)
    return {"tau": float(tau), "rho": float(rho), "topq": topq, "win": win}
