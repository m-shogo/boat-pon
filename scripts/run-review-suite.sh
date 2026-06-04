#!/usr/bin/env bash
set -euo pipefail

FROM_DATE="${1:-2026-01-01}"
TO_DATE="${2:-$(date +%F)}"
SPLIT_DATE="${3:-2026-04-01}"

echo "=== boat-pon review suite ==="
echo "from=${FROM_DATE} to=${TO_DATE} split=${SPLIT_DATE}"
echo "read-only reports only"
echo ""

run() {
  echo "\n--- $* ---"
  "$@"
}

run pnpm report:review-summary -- --from "$FROM_DATE" --to "$TO_DATE"
run pnpm report:rule-candidates -- --from "$FROM_DATE" --to "$TO_DATE" --min-settled 50
run pnpm report:decision-outcomes -- --from "$FROM_DATE" --to "$TO_DATE"
run pnpm report:buy-misses -- --from "$FROM_DATE" --to "$TO_DATE" --limit 30
run pnpm report:missed-hits -- --from "$FROM_DATE" --to "$TO_DATE" --limit 30
run pnpm report:odds-band-outcomes -- --from "$FROM_DATE" --to "$TO_DATE" --decision BUY
run pnpm report:data-quality-outcomes -- --from "$FROM_DATE" --to "$TO_DATE" --decision BUY
run pnpm report:calibration -- --from "$FROM_DATE" --to "$TO_DATE" --decision BUY
run pnpm report:venue-monthly -- --from "$FROM_DATE" --to "$TO_DATE" --decision BUY
run pnpm report:clv -- --from "$FROM_DATE" --to "$TO_DATE"
run pnpm report:feature-breakdown -- --from "$FROM_DATE" --to "$TO_DATE"

# Reports that may not be registered in package.json yet.
if [ -f scripts/report-market-warnings.ts ]; then
  run pnpm exec tsx scripts/report-market-warnings.ts -- --from "$FROM_DATE" --to "$TO_DATE" --limit 50
fi

if [ -f scripts/report-popularity-movement.ts ]; then
  run pnpm exec tsx scripts/report-popularity-movement.ts -- --from "$FROM_DATE" --to "$TO_DATE"
fi

if [ -f scripts/report-payout-sensitivity.ts ]; then
  run pnpm exec tsx scripts/report-payout-sensitivity.ts -- --from "$FROM_DATE" --to "$TO_DATE" --decision BUY
fi

if [ -f scripts/report-time-split-stability.ts ]; then
  run pnpm exec tsx scripts/report-time-split-stability.ts -- --from "$FROM_DATE" --split-date "$SPLIT_DATE" --to "$TO_DATE" --decision BUY --min-settled 50
fi

echo "\n=== review suite complete ==="
