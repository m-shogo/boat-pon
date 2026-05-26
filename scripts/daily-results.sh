#!/bin/bash
# 昨日の結果を取得する。launchd から毎朝 8:30 に呼ばれる。
set -e
cd "$(dirname "$0")/.."

YESTERDAY=$(TZ=Asia/Tokyo date -v-1d +%Y-%m-%d 2>/dev/null || TZ=Asia/Tokyo date -d yesterday +%Y-%m-%d)
echo "[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')] fetch:kyotei24 (昨日: $YESTERDAY)"
npx tsx scripts/fetch-kyotei24.ts
npx tsx scripts/import-kyotei24.ts
