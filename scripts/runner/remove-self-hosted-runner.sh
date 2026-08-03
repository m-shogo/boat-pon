#!/usr/bin/env bash
# runner を停止・アンインストール・登録解除する。credential も削除する。
set -euo pipefail
REPO="${BOAT_PON_REPO:-m-shogo/boat-pon}"
RUNNER_DIR="${BOAT_PON_RUNNER_DIR:-$HOME/actions-runner-boat-pon}"
cd "$RUNNER_DIR"
./svc.sh stop || true
./svc.sh uninstall || true
TOKEN="$(gh api -X POST "repos/${REPO}/actions/runners/remove-token" --jq .token)"
./config.sh remove --token "$TOKEN" || true
unset TOKEN
echo "removed. runner dir kept at $RUNNER_DIR (delete manually if desired)"
