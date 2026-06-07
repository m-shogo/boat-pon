#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f "data/boat.sqlite" ] && [ -z "${BOAT_PON_DB_PATH:-}" ]; then
  echo "[run-roi-autopilot] data/boat.sqlite not found. Set BOAT_PON_DB_PATH or run from boat-pon with local DB." >&2
  exit 1
fi

echo "[run-roi-autopilot] starting read-only ROI autopilot"
echo "[run-roi-autopilot] DB=${BOAT_PON_DB_PATH:-data/boat.sqlite}"

pnpm tsx scripts/run-roi-autopilot.ts

echo "[run-roi-autopilot] done"
echo "[run-roi-autopilot] see reports/roi-autopilot-decision.md"
