#!/bin/sh
# Run the whole service locally: engine (Python, :8788), API + web app (wrangler dev, :8787).
#   ./dev.sh            build the web app once and serve it from the API Worker
#   cd web && npm run dev   for hot reload on :5173 (proxies /v1 to :8787)
set -e
cd "$(dirname "$0")"
python3 engine/devserver.py 8788 &
ENGINE_PID=$!
trap 'kill $ENGINE_PID 2>/dev/null' EXIT INT TERM
(cd web && npm run build --silent)
cd api
npx wrangler d1 migrations apply tournaments --local >/dev/null
NO_PROXY=127.0.0.1,localhost npx wrangler dev --port 8787 --ip 127.0.0.1 \
  --var DEV_MODE:1 --var ENGINE_URL:http://127.0.0.1:8788 --var LINK_SECRET:dev-link-secret \
  --var PUBLIC_URL:http://127.0.0.1:8787
