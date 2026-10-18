"""pairing-lab: an empirical test bench for tournament pairing systems."""

import os

# Every matrix in these simulations is small (at most ~130 x 130), where
# multithreaded BLAS only adds overhead, and the studies already run one worker
# process per core. Letting each worker's BLAS spawn its own threads
# oversubscribes the cores and was measured to slow No Diggity tournaments 15x
# (see results/nodiggity-audit.md). Pin BLAS to one thread unless the caller
# has chosen otherwise. Must run before numpy is imported.
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")
