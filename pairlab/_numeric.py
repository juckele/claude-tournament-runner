"""The few scipy functions pairlab needs, with numpy fallbacks.

scipy is used when it's installed, so research runs are unchanged. The hosted pairing engine
(a Python Cloudflare Worker) leaves scipy out to stay under the Worker size limit, and gets:

- ndtr / log_ndtr: the standard normal CDF and its log, from math.erfc, with an asymptotic
  series far in the lower tail where erfc underflows;
- minimize_lbfgs: unconstrained L-BFGS with a backtracking (Armijo) line search, for the smooth
  No Diggity posterior. Same call shape as scipy.optimize.minimize(fun, x0, jac=True, ...).
"""
from __future__ import annotations

import math
from types import SimpleNamespace

import numpy as np

try:  # pragma: no cover - which branch runs depends on the environment
    from scipy.optimize import minimize as _scipy_minimize
    from scipy.special import log_ndtr as _scipy_log_ndtr
    from scipy.special import ndtr as _scipy_ndtr

    HAVE_SCIPY = True
except ImportError:  # pragma: no cover
    HAVE_SCIPY = False

_SQRT1_2 = 1.0 / math.sqrt(2.0)
_LOG_SQRT_2PI = 0.5 * math.log(2.0 * math.pi)
_erfc = np.frompyfunc(math.erfc, 1, 1)


def np_ndtr(x):
    """Phi(x) = P(Z <= x) for a standard normal Z."""
    x = np.asarray(x, dtype=float)
    return (0.5 * _erfc(-x * _SQRT1_2)).astype(float)


def np_log_ndtr(x):
    """log Phi(x), accurate in both tails."""
    x = np.asarray(x, dtype=float)
    out = np.empty_like(x)
    hi = x > 6.0
    mid = (x <= 6.0) & (x >= -20.0)
    lo = x < -20.0
    # Upper tail: log(1 - q) with q = Phi(-x), tiny.
    out[hi] = np.log1p(-np_ndtr(-x[hi]))
    out[mid] = np.log(np_ndtr(x[mid]))
    # Lower tail: log Phi(x) = -x^2/2 - log(-x) - log sqrt(2 pi) + log(1 - 1/x^2 + 3/x^4 - 15/x^6 ...)
    if lo.any():
        z = x[lo]
        z2 = 1.0 / (z * z)
        series = 1.0 - z2 * (1.0 - 3.0 * z2 * (1.0 - 5.0 * z2 * (1.0 - 7.0 * z2)))
        out[lo] = -0.5 * z * z - np.log(-z) - _LOG_SQRT_2PI + np.log(series)
    return out if out.ndim else float(out)


def np_minimize_lbfgs(fun, x0, args=(), maxiter=500, gtol=1e-9, ftol=1e-13, m=10):
    """Minimise fun(x, *args) -> (f, grad) with L-BFGS. Returns an object with x, fun, nit, success."""
    x = np.asarray(x0, dtype=float).copy()
    f, g = fun(x, *args)
    s_list: list[np.ndarray] = []
    y_list: list[np.ndarray] = []
    nit = 0
    success = bool(np.max(np.abs(g)) <= gtol) if g.size else True
    while not success and nit < maxiter:
        # Two-loop recursion for the search direction.
        q = g.copy()
        alphas = []
        for s, y in zip(reversed(s_list), reversed(y_list)):
            rho = 1.0 / float(y @ s)
            a = rho * float(s @ q)
            alphas.append((rho, a))
            q -= a * y
        if y_list:
            q *= float(s_list[-1] @ y_list[-1]) / float(y_list[-1] @ y_list[-1])
        for (s, y), (rho, a) in zip(zip(s_list, y_list), reversed(alphas)):
            b = rho * float(y @ q)
            q += (a - b) * s
        d = -q
        slope = float(g @ d)
        if slope >= 0:  # not a descent direction: restart from steepest descent
            s_list.clear()
            y_list.clear()
            d = -g
            slope = -float(g @ g)
        # Backtracking line search (Armijo).
        step = 1.0
        while True:
            xn = x + step * d
            fn, gn = fun(xn, *args)
            if np.isfinite(fn) and fn <= f + 1e-4 * step * slope:
                break
            step *= 0.5
            if step < 1e-20:
                return SimpleNamespace(x=x, fun=f, jac=g, nit=nit, success=False, message="line search failed")
        s, y = xn - x, gn - g
        if float(y @ s) > 1e-12 * float(y @ y):
            s_list.append(s)
            y_list.append(y)
            if len(s_list) > m:
                s_list.pop(0)
                y_list.pop(0)
        nit += 1
        rel = (f - fn) / max(abs(f), abs(fn), 1.0)
        x, f, g = xn, fn, gn
        if np.max(np.abs(g)) <= gtol or rel <= ftol:
            success = True
    return SimpleNamespace(x=x, fun=f, jac=g, nit=nit, success=success, message="")


if HAVE_SCIPY:
    ndtr = _scipy_ndtr
    log_ndtr = _scipy_log_ndtr

    def minimize_lbfgs(fun, x0, args=(), maxiter=500, gtol=1e-9, ftol=1e-13):
        return _scipy_minimize(fun, x0, args=args, jac=True, method="L-BFGS-B",
                               options={"maxiter": maxiter, "gtol": gtol, "ftol": ftol})
else:
    ndtr = np_ndtr
    log_ndtr = np_log_ndtr
    minimize_lbfgs = np_minimize_lbfgs
