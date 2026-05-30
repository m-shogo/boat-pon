#!/bin/bash
set -euo pipefail

ROOT_DIR="${BOAT_PON_ROOT_DIR:-/Users/m-shogo/Developer/personal/boat-pon}"
cd "$ROOT_DIR"

mkdir -p logs tmp

LOG_FILE="logs/weekly-rule-review.log"
JSON_FILE="tmp/boat-quality-weekly.json"

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] weekly rule review start"

  echo ""
  echo "## validate:data"
  npm run validate:data

  echo ""
  echo "## report:quality monthly json"
  npm run report:quality -- --days 30 --json > "$JSON_FILE"

  echo ""
  echo "## append rule candidates"
  npm run append:rule-candidates -- \
    --input "$JSON_FILE" \
    --status watch \
    --evidence report:monthly \
    --action 追加観察 \
    --next-check "next weekly"

  echo ""
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] weekly rule review done"
} >> "$LOG_FILE" 2>&1
