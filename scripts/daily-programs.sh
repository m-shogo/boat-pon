#!/bin/bash
# 今日の番組表を取得する。launchd から毎朝呼ばれる。
set -e
cd "$(dirname "$0")/.."

TODAY=$(TZ=Asia/Tokyo date +%Y-%m-%d)
echo "[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')] fetch:official-programs $TODAY"
npx tsx scripts/fetch-official-programs.ts "$TODAY" "$TODAY"
