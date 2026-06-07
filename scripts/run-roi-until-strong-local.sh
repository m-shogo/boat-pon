#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f "data/boat.sqlite" ] && [ -z "${BOAT_PON_DB_PATH:-}" ]; then
  echo "[run-roi-until-strong-local] data/boat.sqlite not found. Set BOAT_PON_DB_PATH or run from boat-pon with local DB." >&2
  exit 1
fi

MAX_ROUNDS="${MAX_ROUNDS:-3}"
ROUND=1
FINAL="NO-GO"

echo "[run-roi-until-strong-local] DB=${BOAT_PON_DB_PATH:-data/boat.sqlite}"
echo "[run-roi-until-strong-local] max rounds=${MAX_ROUNDS}"

while [ "$ROUND" -le "$MAX_ROUNDS" ]; do
  echo "[run-roi-until-strong-local] round ${ROUND}/${MAX_ROUNDS}"
  pnpm tsx scripts/run-roi-relentless.ts

  FINAL=$(node -e "const fs=require('fs');const p='reports/roi-relentless.json';if(!fs.existsSync(p)){console.log('NO-GO');process.exit(0)};const r=JSON.parse(fs.readFileSync(p,'utf8'));console.log(r.finalDecision||'NO-GO')")
  echo "[run-roi-until-strong-local] finalDecision=${FINAL}"

  mkdir -p reports/roi-until-strong
  cp reports/roi-relentless.json "reports/roi-until-strong/round-${ROUND}-roi-relentless.json"
  cp reports/roi-relentless.md "reports/roi-until-strong/round-${ROUND}-roi-relentless.md"

  if [ "$FINAL" = "PAPER-STRONG" ]; then
    echo "[run-roi-until-strong-local] strong candidate found"
    break
  fi

  ROUND=$((ROUND + 1))
done

cat > reports/roi-until-strong.md <<EOF
# ROI Until Strong

- finalDecision: ${FINAL}
- rounds: ${ROUND}
- maxRounds: ${MAX_ROUNDS}

Main report: reports/roi-relentless.md
Archive: reports/roi-until-strong/
EOF

cat > reports/roi-until-strong.json <<EOF
{
  "finalDecision": "${FINAL}",
  "rounds": ${ROUND},
  "maxRounds": ${MAX_ROUNDS},
  "mainReport": "reports/roi-relentless.md",
  "archiveDir": "reports/roi-until-strong"
}
EOF

echo "[run-roi-until-strong-local] done"
echo "[run-roi-until-strong-local] see reports/roi-until-strong.md"
