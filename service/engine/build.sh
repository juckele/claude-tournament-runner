#!/bin/sh
# Vendor pairlab into the Worker's source tree before deploying:
#   ./build.sh && uv run pywrangler deploy
set -e
cd "$(dirname "$0")"
rm -rf src/pairlab
cp -r ../../pairlab src/pairlab
find src/pairlab -name __pycache__ -prune -exec rm -rf {} +
