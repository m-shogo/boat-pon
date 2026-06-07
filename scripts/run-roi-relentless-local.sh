#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f "data/boat.sqlite" ] && [ -z "${BOAT_PON_DB_PATH:-}" ]; then
  echo "[run-roi-relentless-local] data/boat.sqlite not found. Set BOAT_PON_DB_PATH or run from boat-pon with local DB." >&2
  exit 1
fi

echo "[run-roi-relentless-local] starting relentless read-only ROI exploration"
echo "[run-roi-relentless-local] DB=${BOAT_PON_DB_PATH:-data/boat.sqlite}"

pnpm tsx scripts/run-roi-relentless.ts

echo "[run-roi-relentless-local] done"
echo "[run-roi-relentless-local] main report: reports/roi-relentless.md"
echo "[run-roi-relentless-local] JSON report: reports/roi-relentless.json"
