#!/usr/bin/env bash
# runner の登録・service・label 状態を確認する（read-only）。
set -euo pipefail
REPO="${BOAT_PON_REPO:-m-shogo/boat-pon}"
RUNNER_DIR="${BOAT_PON_RUNNER_DIR:-$HOME/actions-runner-boat-pon}"
echo "== GitHub side =="
gh api "repos/${REPO}/actions/runners" --jq '.runners[] | {name, status, busy, labels: [.labels[].name]}' 2>&1 || echo "(needs admin)"
echo "== local service =="
if [ -d "$RUNNER_DIR" ]; then (cd "$RUNNER_DIR" && ./svc.sh status 2>&1 | head -5); else echo "runner dir not present: $RUNNER_DIR"; fi
