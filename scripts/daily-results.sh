#!/bin/bash
# 当日の結果を取得する。launchd から毎日 21:30 JST に呼ばれる。
# 21:30 JST は全レース終了後で、kyotei24 の当日結果ページに出目・払戻が揃っている。
set -e
cd "$(dirname "$0")/.."

TODAY=$(TZ=Asia/Tokyo date '+%Y-%m-%d')
echo "[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')] fetch:kyotei24 (今日: $TODAY)"
npx tsx scripts/fetch-kyotei24.ts
npx tsx scripts/import-kyotei24.ts
