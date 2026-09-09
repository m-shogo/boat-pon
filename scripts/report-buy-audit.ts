import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error("BUY_AUDIT_DB_MISSING");
  process.exit(1);
}

const primaryDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "BUY_AUDIT_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(primaryDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
try {
  assertOfficialSettlementIntegrity(db, args.runKind, args.modelVersion);

  type AuditRow = {
    run_kind: string; model_version: string; buy_n: number;
    settled_n: number; pending_n: number; hits: number;
    hit_rate: number | null; roi: number | null;
    max_hit_odds: number; max_hit_payout_units: number; latest_date: string | null;
  };
  const rows = db.prepare(`
WITH buys AS (
  SELECT
    dh.*,
    ${payoutBetTypeSql("dh.bet_type")} AS payout_bet_type
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND (? = 'all' OR dh.run_kind = ?)
    AND (? = 'all' OR dh.model_version = ?)
)
SELECT
  COALESCE(run_kind, '(null)') AS run_kind,
  COALESCE(model_version, '(null)') AS model_version,
  COUNT(*) AS buy_n,
  SUM(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' THEN 1 ELSE 0 END) AS settled_n,
  SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) AS pending_n,
  SUM(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' AND selection = result THEN 1 ELSE 0 END) AS hits,
  ROUND(1.0 * SUM(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' AND selection = result THEN 1 ELSE 0 END)
    / NULLIF(SUM(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' THEN 1 ELSE 0 END), 0), 4) AS hit_rate,
  ROUND(SUM(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' AND selection = result THEN
      (SELECT rp.payout_yen / 100.0
       FROM race_payouts rp
       WHERE rp.race_id = buys.race_id
         AND rp.bet_type = buys.payout_bet_type
         AND rp.combination = buys.selection
         AND rp.returned = 0
         AND rp.payout_yen IS NOT NULL
         AND rp.payout_yen > 0)
    ELSE 0 END)
    / NULLIF(SUM(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' THEN 1 ELSE 0 END), 0), 3) AS roi,
  MAX(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' AND selection = result THEN current_odds ELSE 0 END) AS max_hit_odds,
  MAX(CASE WHEN returned = 0 AND result IS NOT NULL AND TRIM(result) != '' AND selection = result THEN
      (SELECT rp.payout_yen / 100.0
       FROM race_payouts rp
       WHERE rp.race_id = buys.race_id
         AND rp.bet_type = buys.payout_bet_type
         AND rp.combination = buys.selection
         AND rp.returned = 0
         AND rp.payout_yen IS NOT NULL
         AND rp.payout_yen > 0)
    ELSE 0 END) AS max_hit_payout_units,
  MAX(date) AS latest_date
FROM buys
GROUP BY run_kind, model_version
ORDER BY run_kind, model_version
`).all(args.runKind, args.runKind, args.modelVersion, args.modelVersion) as AuditRow[];

  const withExMax = rows.map((row) => {
    const settled = Number(row.settled_n ?? 0);
    const roi = nullableNumber(row.roi);
    const maxHitPayoutUnits = Number(row.max_hit_payout_units ?? 0);
    const roiExMax = roi != null && settled > 1 && maxHitPayoutUnits > 0
      ? Math.round((((roi * settled) - maxHitPayoutUnits) / (settled - 1)) * 1000) / 1000
      : null;
    return { ...row, roi_ex_max: roiExMax };
  });

  if (args.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      runKind: args.runKind,
      modelVersion: args.modelVersion,
      roiSource: "official race_payouts.payout_yen",
      rows: withExMax,
      note: reportNote(args.runKind),
    }, null, 2));
  } else {
    console.log("# Boat Pon decision audit");
    console.log(`runKind=${args.runKind} modelVersion=${args.modelVersion}`);
    console.log("roiSource=official race_payouts.payout_yen");
    console.log(`Note: ${reportNote(args.runKind)}`);
    console.log("| run_kind | model_version | n | settled | pending | hits | hitRate | ROI | roiExMax | maxHitOdds | maxHitPayoutUnits | latestDate |");
    console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const row of withExMax) {
      console.log(`| ${row.run_kind} | ${row.model_version} | ${row.buy_n} | ${row.settled_n} | ${row.pending_n} | ${row.hits} | ${fmt(row.hit_rate)} | ${fmt(row.roi)} | ${fmt(row.roi_ex_max)} | ${fmt(row.max_hit_odds)} | ${fmt(row.max_hit_payout_units)} | ${row.latest_date ?? "-"} |`);
    }
  }
} finally {
  db.close();
}

function payoutBetTypeSql(column: string) {
  return `CASE ${column}
    WHEN '3連単' THEN 'trifecta'
    WHEN '3連複' THEN 'trio'
    WHEN '2連単' THEN 'exacta'
    WHEN '2連複' THEN 'quinella'
    WHEN '拡連複' THEN 'wide'
    WHEN 'trifecta' THEN 'trifecta'
    WHEN 'trio' THEN 'trio'
    WHEN 'exacta' THEN 'exacta'
    WHEN 'quinella' THEN 'quinella'
    WHEN 'wide' THEN 'wide'
    ELSE NULL
  END`;
}

function assertOfficialSettlementIntegrity(db: DatabaseSync, runKindValue: string, modelVersionValue: string): void {
  const row = db.prepare(`
WITH blank_settled_buy AS (
  SELECT COUNT(*) AS n
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.returned = 0
    AND dh.result IS NOT NULL
    AND TRIM(dh.result) = ''
    AND (? = 'all' OR dh.run_kind = ?)
    AND (? = 'all' OR dh.model_version = ?)
), settled_buy AS (
  SELECT DISTINCT
    dh.race_id,
    dh.bet_type,
    ${payoutBetTypeSql("dh.bet_type")} AS payout_bet_type,
    dh.selection,
    dh.result
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.returned = 0
    AND dh.result IS NOT NULL
    AND TRIM(dh.result) != ''
    AND (? = 'all' OR dh.run_kind = ?)
    AND (? = 'all' OR dh.model_version = ?)
), invalid AS (
  SELECT s.race_id, s.bet_type, s.selection
  FROM settled_buy s
  WHERE s.payout_bet_type IS NULL
     OR (s.selection = s.result AND (
       (SELECT COUNT(*)
        FROM race_payouts rp
        WHERE rp.race_id = s.race_id
          AND rp.bet_type = s.payout_bet_type
          AND rp.combination = s.selection) != 1
       OR
       (SELECT COUNT(*)
        FROM race_payouts rp
        WHERE rp.race_id = s.race_id
          AND rp.bet_type = s.payout_bet_type
          AND rp.combination = s.selection
          AND rp.returned = 0
          AND rp.payout_yen IS NOT NULL
          AND rp.payout_yen > 0) != 1
     ))
)
SELECT
  (SELECT n FROM blank_settled_buy) AS blankResults,
  (SELECT COUNT(*) FROM invalid) AS invalid
`).get(
    runKindValue, runKindValue, modelVersionValue, modelVersionValue,
    runKindValue, runKindValue, modelVersionValue, modelVersionValue,
  ) as { blankResults: number | bigint | null; invalid: number | bigint | null };

  const blankResults = Number(row.blankResults ?? 0);
  const invalid = Number(row.invalid ?? 0);
  if (!Number.isSafeInteger(blankResults) || blankResults < 0 || !Number.isSafeInteger(invalid) || invalid < 0) {
    throw new Error("BUY_AUDIT_SETTLEMENT_COUNT_INVALID");
  }
  if (blankResults > 0) {
    throw new Error("BUY_AUDIT_BLANK_SETTLED_RESULT_UNSUPPORTED");
  }
  if (invalid > 0) {
    throw new Error("BUY_AUDIT_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED");
  }
}

function parseArgs(argv: string[]) {
  const parsed = { runKind: "paper-live", modelVersion: LIVE_MONITOR_MODEL_VERSION, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--run-kind") { parsed.runKind = runKind(value); i += 1; }
    else if (key === "--model-version") { parsed.modelVersion = modelVersion(value); i += 1; }
    else if (key === "--json") parsed.json = true;
    else if (key === "--help") { console.log("Usage: npm run report:buy-audit -- [--run-kind paper-live|historical-backfill|manual-test|sample|all] [--model-version VERSION|all] [--json]"); process.exit(0); }
    else if (key === "--") { /* pnpm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}
function runKind(value: string | undefined) {
  if (value === "paper-live" || value === "historical-backfill" || value === "manual-test" || value === "sample" || value === "all") return value;
  throw new Error(`invalid --run-kind: ${value ?? ""}`);
}
function modelVersion(value: string | undefined) {
  if (!value) throw new Error("--model-version requires a value");
  return value;
}
function nullableNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function fmt(value: unknown) {
  const n = nullableNumber(value);
  return n == null ? "-" : n.toFixed(3);
}
function reportNote(runKindValue: string) {
  if (runKindValue === "paper-live") return "paper-live only: use this for live observation metrics.";
  if (runKindValue === "historical-backfill") return "historical-backfill only: research/backfill metrics, not live observation.";
  return "mixed run_kind: diagnostic only.";
}
