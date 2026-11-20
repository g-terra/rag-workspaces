#!/usr/bin/env bash
# Restart Langflow (reloads custom components and re-imports flows/), wait for health.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose restart langflow >/dev/null 2>&1
for _ in $(seq 1 100); do curl -sf http://localhost:7860/health_check >/dev/null && exit 0; sleep 2; done
echo "Langflow did not come back"; exit 1
