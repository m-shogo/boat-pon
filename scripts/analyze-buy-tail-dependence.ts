import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assessBuyTailDependence, type BuyTailWindowInput } from "../src/presentation/buyTailDependence";
import { buildBuyOutcomeSettlementSource, type BuyOutcomeSettlementSource } from "../src/presentation/buyOutcomeSettlementSource";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY tail source DB is unavailable");

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const source = buildBuyOutcomeSettlementSource({ runKind: args.runKind });
  assertPaperLiveSettlementConsistency(db, source);
  const settledEconomic = "outcome_result IS NOT NULL AND outcome_payout_yen IS NOT NULL AND outcome_returned = 0";
  const total = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS settled FROM buy_outcomes WHERE ${settledEconomic}
  `).get(...source.params) as { settled: number | bigint | null };

  const rows = db.prepare(`
    ${source.cte},
    ordered_buy AS (
      SELECT
        CASE WHEN selection = outcome_result THEN 1 ELSE 0 END AS hit,
        CASE WHEN selection = outcome_result THEN outcome_payout_yen / 100.0 ELSE 0 END AS payout,
        ROW_NUMBER() OVER (
          ORDER BY date DESC, venue DESC, race_no DESC, race_id DESC, bet_type DESC, selection DESC
        ) AS outcome_rank
      FROM buy_outcomes
      WHERE ${settledEconomic}
    ),
    split_buy AS (
      SELECT
        CASE
          WHEN outcome_rank <= ? THEN 'recent'
          WHEN outcome_rank <= ? THEN 'prior'
          ELSE NULL
        END AS window_name,
        hit,
        payout
      FROM ordered_buy
      WHERE outcome_rank <= ?
    )
    SELECT
      window_name,
      COUNT(*) AS settled,
      COALESCE(SUM(hit), 0) AS hits,
      COALESCE(SUM(payout), 0) AS payoutOddsSum,
      COALESCE(MAX(payout), 0) AS maxPayoutOdds
    FROM split_buy
    WHERE window_name IS NOT NULL
    GROUP BY window_name
  `).all(...source.params, args.windowSize, args.windowSize * 2, args.windowSize * 2) as Array<Record<string, unknown>>;

  const recent = toWindow(rows.find((row) => row.window_name === "recent"));
  const prior = toWindow(rows.find((row) => row.window_name === "prior"));
  const assessment = assessBuyTailDependence(recent, prior, {
    windowSize: args.windowSize,
    minimumTailGap: args.minimumTailGap,
  });
  const totalSettled = count(total.settled);
  const generatedAt = new Date().toISOString();
  const publicRecord = {
    schemaVersion: "buy-tail-dependence-public-v1",
    generatedAt,
    status: assessment.status,
    windowSize: assessment.windowSize,
    minimumTailGap: assessment.minimumTailGap,
    totalSettled,
    support: {
      recentSettled: assessment.recent.settled,
      priorSettled: assessment.prior.settled,
      missingSettledToCompare: assessment.missingSettledToCompare,
    },
    recent: publicWindow(assessment.recent),
    prior: publicWindow(assessment.prior),
    productionChangeAllowed: false,
  };
  const privateRecord = {
    schemaVersion: "buy-tail-dependence.0.1",
    generatedAt,
    policy: {
      runKind: args.runKind,
      independentWindowSize: args.windowSize,
      minimumTailGap: args.minimumTailGap,
      settlementEconomics: source.usesOfficialRaceResults
        ? "official-race-results-payout-yen-per-100"
        : "decision-history-payout-yen-per-100",
      productionChangeAllowed: false,
      note: "Temporal stability research only. Two complete non-overlapping windows are required before classification.",
    },
    totalSettled,
    assessment,
  };

  if (args.outputPublic) await atomicWrite(args.outputPublic, `${JSON.stringify(publicRecord, null, 2)}\n`);
  const retained = args.retainPrivateDir ? await retain(args.retainPrivateDir, privateRecord) : false;
  console.log(JSON.stringify({
    status: assessment.status,
    totalSettled,
    recentSettled: assessment.recent.settled,
    priorSettled: assessment.prior.settled,
    missingSettledToCompare: assessment.missingSettledToCompare,
    recentTailGap: assessment.recent.tailGap,
    priorTailGap: assessment.prior.tailGap,
    retained,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

function assertPaperLiveSettlementConsistency(db: DatabaseSync, source: BuyOutcomeSettlementSource) {
  if (!source.usesOfficialRaceResults) return;
  const row = db.prepare(`
    ${source.cte}
    SELECT COUNT(*) AS mismatches
    FROM buy_outcomes
    WHERE decision_result IS NOT NULL
      AND outcome_result IS NOT NULL
      AND decision_result != outcome_result
  `).get(...source.params) as { mismatches: number | bigint | null };
  if (count(row.mismatches) > 0) throw new Error("paper-live settlement result conflicts with official race_results");
}

function parseArgs(argv: string[]) {
  const parsed = {
    windowSize: 30,
    minimumTailGap: 0.15,
    runKind: null as string | null,
    outputPublic: null as string | null,
    retainPrivateDir: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--window-size") { parsed.windowSize = boundedInt(value, 10, 200); i += 1; }
    else if (key === "--min-tail-gap") { parsed.minimumTailGap = boundedNumber(value, 0.05, 2); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--output-public") { parsed.outputPublic = safeOutput(value); i += 1; }
    else if (key === "--retain-private-dir") { parsed.retainPrivateDir = safePrivateDir(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}

function toWindow(row: Record<string, unknown> | undefined): BuyTailWindowInput {
  return {
    settled: count(row?.settled),
    hits: count(row?.hits),
    payoutOddsSum: finite(row?.payoutOddsSum),
    maxPayoutOdds: finite(row?.maxPayoutOdds),
  };
}
function publicWindow(window: { settled: number; hits: number; roi: number | null; roiExMax: number | null; tailGap: number | null; tailDependent: boolean }) {
  return {
    settled: window.settled,
    hits: window.hits,
    roi: window.roi,
    roiExMax: window.roiExMax,
    tailGap: window.tailGap,
    tailDependent: window.tailDependent,
  };
}
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function boundedNumber(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error("invalid numeric option"); return n; }
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function safeOutput(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("output must be a relative json path"); return value; }
function safePrivateDir(value: string | undefined) { if (!value || !/^data\/private\/[A-Za-z0-9_./-]+$/.test(value) || value.includes("..")) throw new Error("private retention must stay under data/private"); return value.replace(/\/$/, ""); }
function count(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
function finite(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? n : 0; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
async function retain(dir: string, record: unknown): Promise<boolean> {
  const semantic = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  delete semantic.generatedAt;
  const digest = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  const envelope = { schemaVersion: "buy-tail-dependence-ledger.0.1", semanticDigest: digest, recordedAt: new Date().toISOString(), record };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `tail-${digest}.json`);
  try {
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as { semanticDigest?: string };
    if (existing.semanticDigest !== digest) throw new Error("private BUY tail ledger conflict");
    return false;
  }
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
