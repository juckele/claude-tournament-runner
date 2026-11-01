"""
No Diggity: players as normal distributions, fitted to the match history.

Model
-----
Each player i has a performance distribution N(mu_i, sigma_i^2). In a game,
White performs X_w + white and Black performs X_b; with

    m = mu_w - mu_b + white,      s = sqrt(sigma_w^2 + sigma_b^2),

White wins if the performance gap exceeds the draw band delta, Black wins if
it falls below -delta, and anything in between is a draw:

    P(White wins) = Phi((m - delta) / s)
    P(Black wins) = Phi((-m - delta) / s)
    P(draw)       = 1 - both

(an ordered-probit / Thurstone model). With every sigma fixed at 1 it is a
Thurstone-Mosteller model with a White advantage and a draw band; with sigma
learned, a player can be steady (small sigma: rarely upset, rarely upsets) or
streaky (large sigma).

Fit
---
Maximum a posteriori over theta = (mu, log sigma, white, log delta) with weak
priors that pin down what the data can't:

    mu_i        ~ N(0, mu_sd^2)       fixes the location (only gaps are observed) and
                                      shrinks thin evidence; mu_sd = 0.75 by default
                                      (tools/nd_prior_sensitivity.py: 1.5 ranked
                                      ~0.004 tau worse, 0.5-1.0 about the same)
    log sigma_i ~ N(0, sigma_sd^2)    fixes the scale; sigma_sd is the dial:
                                      0 = sigma fixed at 1 (not learned)
    white       ~ N(0, white_sd^2)
    log delta   ~ N(log 0.25, 1)      keeps the draw band finite with no draws

minimised with L-BFGS-B on analytic gradients, warm-started from the previous
fit when results are added (a tournament refits after every batch).

Every per-game quantity touches at most six parameters (mu_w, mu_b,
log sigma_w, log sigma_b, white, log delta), so per-game gradients are (G, 6)
arrays scattered into theta: everything is vectorised over games.
"""

from __future__ import annotations

import numpy as np
from ._numeric import log_ndtr, minimize_lbfgs, ndtr

_LOG_SQRT_2PI = 0.5 * np.log(2 * np.pi)


def _mills(u):
    """phi(u) / Phi(u), stable for very negative u."""
    return np.exp(-0.5 * u * u - _LOG_SQRT_2PI - log_ndtr(u))


class NDModel:
    def __init__(self, n, sigma_sd=0.3, mu_sd=0.75, white_sd=0.5, delta_mean=np.log(0.25),
                 delta_sd=1.0):
        self.n = n
        self.learn_sigma = sigma_sd > 0
        self.sigma_sd = sigma_sd
        self.mu_sd = mu_sd
        self.white_sd = white_sd
        self.delta_mean = delta_mean
        self.delta_sd = delta_sd
        self.P = (2 * n if self.learn_sigma else n) + 2
        self.iw = self.P - 2  # index of the white advantage
        self.idl = self.P - 1  # index of log delta

    # ------------------------------------------------------------------ layout
    def initial(self):
        th = np.zeros(self.P)
        th[self.idl] = self.delta_mean
        return th

    def unpack(self, th):
        n = self.n
        mu = th[:n]
        a = th[n:2 * n] if self.learn_sigma else np.zeros(n)
        return mu, a, th[self.iw], th[self.idl]

    def coords(self, w, b):
        """Parameter indices touched by games (w, b): (G, 6) or (G, 4)."""
        w = np.asarray(w)
        b = np.asarray(b)
        cols = [w, b]
        if self.learn_sigma:
            cols += [self.n + w, self.n + b]
        cols += [np.full_like(w, self.iw), np.full_like(w, self.idl)]
        return np.stack(cols, axis=1)

    # ------------------------------------------------------------------ games
    def game_terms(self, th, w, b, y):
        """Log-likelihood of each game and its gradient w.r.t. the game's
        coordinates (same column order as coords()). y = White's score."""
        mu, a, white, ldelta = self.unpack(th)
        w = np.asarray(w)
        b = np.asarray(b)
        y = np.asarray(y, dtype=float)
        sw2 = np.exp(2 * a[w])
        sb2 = np.exp(2 * a[b])
        s = np.sqrt(sw2 + sb2)
        delta = np.exp(ldelta)
        m = mu[w] - mu[b] + white
        u1 = (m - delta) / s        # White wins iff Z < u1
        u2 = (-m - delta) / s       # Black wins iff Z < u2
        win = y == 1.0
        loss = y == 0.0
        draw = ~(win | loss)
        logp = np.empty(len(y))
        dm = np.zeros(len(y))       # d logp / dm
        dd = np.zeros(len(y))       # d logp / d delta
        ds = np.zeros(len(y))       # d logp / d s
        if win.any():
            u = u1[win]
            r = _mills(u)
            logp[win] = log_ndtr(u)
            dm[win] = r / s[win]
            dd[win] = -r / s[win]
            ds[win] = -r * u / s[win]
        if loss.any():
            u = u2[loss]
            r = _mills(u)
            logp[loss] = log_ndtr(u)
            dm[loss] = -r / s[loss]
            dd[loss] = -r / s[loss]
            ds[loss] = -r * u / s[loss]
        if draw.any():
            # P(draw) = P(-delta < gap < delta) = Phi(hi) - Phi(lo) with
            # hi = (m + delta)/s = -u2 and lo = (m - delta)/s = u1 (by symmetry).
            hi = -u2[draw]
            lo = u1[draw]
            sd_ = s[draw]
            pd = np.maximum(ndtr(hi) - ndtr(lo), 1e-300)
            ph = np.exp(-0.5 * hi * hi - _LOG_SQRT_2PI)
            pl = np.exp(-0.5 * lo * lo - _LOG_SQRT_2PI)
            logp[draw] = np.log(pd)
            # d hi/dm = 1/s, d hi/d delta = 1/s, d hi/ds = -hi/s; lo: 1/s, -1/s, -lo/s
            dm[draw] = (ph - pl) / sd_ / pd
            dd[draw] = (ph * (1 / sd_) - pl * (-1 / sd_)) / pd
            ds[draw] = (ph * (-hi / sd_) - pl * (-lo / sd_)) / pd
        cols = [dm, -dm]
        if self.learn_sigma:
            cols += [ds * sw2 / s, ds * sb2 / s]
        cols += [dm, dd * delta]
        return logp, np.stack(cols, axis=1)

    def probs(self, th, w, b):
        """(P White wins, P draw, P Black wins) for pairings (w, b)."""
        mu, a, white, ldelta = self.unpack(th)
        s = np.sqrt(np.exp(2 * a[w]) + np.exp(2 * a[b]))
        m = mu[w] - mu[b] + white
        d = np.exp(ldelta)
        pw = ndtr((m - d) / s)
        pb = ndtr((-m - d) / s)
        return pw, 1 - pw - pb, pb

    # ------------------------------------------------------------------ posterior
    def prior_terms(self, th):
        mu, a, white, ldelta = self.unpack(th)
        f = 0.5 * (mu ** 2).sum() / self.mu_sd ** 2
        g = np.zeros(self.P)
        g[:self.n] = mu / self.mu_sd ** 2
        if self.learn_sigma:
            f += 0.5 * (a ** 2).sum() / self.sigma_sd ** 2
            g[self.n:2 * self.n] = a / self.sigma_sd ** 2
        f += 0.5 * white ** 2 / self.white_sd ** 2
        g[self.iw] = white / self.white_sd ** 2
        f += 0.5 * (ldelta - self.delta_mean) ** 2 / self.delta_sd ** 2
        g[self.idl] = (ldelta - self.delta_mean) / self.delta_sd ** 2
        return f, g

    def prior_precision(self):
        d = np.empty(self.P)
        d[:self.n] = 1 / self.mu_sd ** 2
        if self.learn_sigma:
            d[self.n:2 * self.n] = 1 / self.sigma_sd ** 2
        d[self.iw] = 1 / self.white_sd ** 2
        d[self.idl] = 1 / self.delta_sd ** 2
        return np.diag(d)

    def objective(self, th, w, b, y):
        """Negative log posterior and its gradient."""
        f, g = self.prior_terms(th)
        if len(w):
            logp, gr = self.game_terms(th, w, b, y)
            f -= logp.sum()
            g -= np.bincount(self.coords(w, b).ravel(), weights=gr.ravel(), minlength=self.P)
        return f, g

    def fit(self, w, b, y, theta0=None, tol=1e-9, maxiter=500):
        th0 = self.initial() if theta0 is None else theta0
        res = minimize_lbfgs(self.objective, th0, args=(np.asarray(w), np.asarray(b), np.asarray(y)),
                             maxiter=maxiter, gtol=tol, ftol=1e-13)
        self.last_fit = res
        return res.x

    def fisher(self, th, w, b):
        """Expected (Fisher) information of the games plus the prior precision:
        sum over games of E_y[g g^T] with y drawn from the model itself. Positive
        definite, and cheap: per game a 6x6 block."""
        H = self.prior_precision()
        if len(w) == 0:
            return H
        w = np.asarray(w)
        b = np.asarray(b)
        pw, pd, pb = self.probs(th, w, b)
        C = self.coords(w, b)
        k = C.shape[1]
        blocks = np.zeros((len(w), k, k))
        for y, p in ((1.0, pw), (0.5, pd), (0.0, pb)):
            _, gr = self.game_terms(th, w, b, np.full(len(w), y))
            blocks += p[:, None, None] * gr[:, :, None] * gr[:, None, :]
        rows = np.repeat(C, k, axis=1).ravel()
        cols = np.tile(C, (1, k)).ravel()
        H += np.bincount(rows * self.P + cols, weights=blocks.ravel(),
                         minlength=self.P * self.P).reshape(self.P, self.P)
        return H

    def expected_scores(self, th):
        """Each player's expected score against a uniformly chosen other player,
        averaged over colours: the model's estimate of the strength the
        ranking is scored against."""
        n = self.n
        w, b = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
        pw, pd, pb = self.probs(th, w.ravel(), b.ravel())
        e_white = (pw + 0.5 * pd).reshape(n, n)
        e = 0.5 * (e_white + (1 - e_white.T))
        np.fill_diagonal(e, 0.0)
        return e.sum(axis=1) / max(n - 1, 1)


def games_arrays(state):
    if not state.games:
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0)
    g = np.array(state.games)
    return g[:, 0].astype(int), g[:, 1].astype(int), g[:, 2]


def fit_state(state, sigma_sd=0.3, theta0=None):
    model = NDModel(state.n, sigma_sd=sigma_sd)
    w, b, y = games_arrays(state)
    th = model.fit(w, b, y, theta0)
    return model, th
