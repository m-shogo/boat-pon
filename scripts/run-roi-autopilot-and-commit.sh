#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f "data/boat.sqlite" ] && [ -z "${BOAT_PON_DB_PATH:-}" ]; then
  echo "[run-roi-autopilot-and-commit] data/boat.sqlite not found. Set BOAT_PON_DB_PATH or run from boat-pon with local DB." >&2
  exit 1
fi

echo "[run-roi-autopilot-and-commit] starting read-only ROI autopilot"
echo "[run-roi-autopilot-and-commit] DB=${BOAT_PON_DB_PATH:-data/boat.sqlite}"

bash scripts/run-roi-autopilot.sh

echo "[run-roi-autopilot-and-commit] staging reports only"

git add \
  reports/roi-autopilot-decision.md \
  reports/roi-autopilot-decision.json \
  reports/roi-search-matrix.md \
  reports/roi-search-matrix.json \
  reports/roi-search-matrix/ \
  reports/roi-pattern-search.md \
  reports/roi-pattern-search.json \
  reports/roi-hypothesis-sets.md \
  reports/roi-hypothesis-sets.json \
  reports/roi-commit-review.md \
  reports/roi-commit-review.json \
  reports/bet-strategy-simulation.md \
  reports/bet-strategy-simulation.json

if git diff --cached --quiet; then
  echo "[run-roi-autopilot-and-commit] no report changes to commit"
else
  git commit -m "Update ROI autopilot reports"
  echo "[run-roi-autopilot-and-commit] committed report updates"
fi

if [ "${PUSH:-0}" = "1" ]; then
  git push
  echo "[run-roi-autopilot-and-commit] pushed"
else
  echo "[run-roi-autopilot-and-commit] not pushed. Run with PUSH=1 to push automatically."
fi

echo "[run-roi-autopilot-and-commit] done"
echo "[run-roi-autopilot-and-commit] see reports/roi-autopilot-decision.md"
