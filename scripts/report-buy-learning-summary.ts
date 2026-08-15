import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildBuyLearningSummary } from "../src/presentation/buyLearningSummary";

const args = parseArgs(process.argv.slice(2));
const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) throw new Error("BUY learning source DB is unavailable");

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const where = ["decision = 'BUY'"];
  const params: Array<string | number> = [];
  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  const predicate = where.join(" AND ");

  const all = db.prepare(`
    SELECT
      COUNT(*) AS totalDecisions,
      COALESCE(SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END), 0) AS settled,
      COALESCE(SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END), 0) AS hits,
      COALESCE(SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END), 0) AS payoutOddsSum,
      COALESCE(MAX(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END), 0) AS maxPayoutOdds,
      AVG(CASE WHEN result IS NOT NULL AND returned = 0 THEN estimated_hit_rate ELSE NULL END) AS avgEstimatedHitRate,
      COALESCE(SUM(CASE WHEN result IS NOT NULL AND returned = 0 AND selection != result AND sample_size IS NOT NULL AND sample_size < 30 THEN 1 ELSE 0 END), 0) AS smallSampleMisses,
      COALESCE(SUM(CASE WHEN result IS NOT NULL AND returned = 0 AND selection != result AND estimated_hit_rate IS NOT NULL AND estimated_hit_rate >= 0.5 THEN 1 ELSE 0 END), 0) AS highConfidenceMisses,
      COALESCE(SUM(CASE WHEN result IS NOT NULL AND returned = 0 AND selection != result AND ev IS NOT NULL AND ev >= 1.2 THEN 1 ELSE 0 END), 0) AS highEvMisses
    FROM decision_history
    WHERE ${predicate}
  `).get(...params) as AggregateRow;

  const recentParams = [...params, args.recent];
  const recent = db.prepare(`
    WITH recent_buy AS (
      SELECT selection, result, returned, current_odds
      FROM decision_history
      WHERE ${predicate} AND result IS NOT NULL AND returned = 0
      ORDER BY date DESC, venue DESC, race_no DESC, id DESC
      LIMIT ?
    )
    SELECT
      COUNT(*) AS settled,
      COALESCE(SUM(CASE WHEN selection = result THEN 1 ELSE 0 END), 0) AS hits,
      COALESCE(SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END), 0) AS payoutOddsSum
    FROM recent_buy
  `).get(...recentParams) as RecentRow;

  const summary = buildBuyLearningSummary({
    generatedAt: new Date().toISOString(),
    from: args.from,
    to: args.to,
    totalDecisions: number(all.totalDecisions),
    settled: number(all.settled),
    hits: number(all.hits),
    payoutOddsSum: finite(all.payoutOddsSum),
    maxPayoutOdds: finite(all.maxPayoutOdds),
    avgEstimatedHitRate: nullableFinite(all.avgEstimatedHitRate),
    recentSettled: number(recent.settled),
    recentHits: number(recent.hits),
    recentPayoutOddsSum: finite(recent.payoutOddsSum),
    smallSampleMisses: number(all.smallSampleMisses),
    highConfidenceMisses: number(all.highConfidenceMisses),
    highEvMisses: number(all.highEvMisses),
  });

  if (args.output) await atomicWrite(args.output, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({
    status: summary.status,
    output: args.output ?? null,
    settled: summary.performance.settled,
    hits: summary.performance.hits,
    misses: summary.performance.misses,
    learningCount: summary.learnings.length,
    researchCandidateCount: summary.researchCandidates.length,
    productionChangeAllowed: false,
  }));
} finally {
  db.close();
}

type AggregateRow = Record<"totalDecisions" | "settled" | "hits" | "payoutOddsSum" | "maxPayoutOdds" | "smallSampleMisses" | "highConfidenceMisses" | "highEvMisses", number | bigint | null> & { avgEstimatedHitRate: number | null };
type RecentRow = { settled: number | bigint | null; hits: number | bigint | null; payoutOddsSum: number | null };

function parseArgs(argv: string[]) {
  const parsed = { from: null as string | null, to: null as string | null, runKind: null as string | null, modelVersion: null as string | null, recent: 30, output: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--from") { parsed.from = date(value); i += 1; }
    else if (key === "--to") { parsed.to = date(value); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = safeArg(value); i += 1; }
    else if (key === "--model-version") { parsed.modelVersion = safeArg(value); i += 1; }
    else if (key === "--recent") { parsed.recent = boundedInt(value, 10, 200); i += 1; }
    else if (key === "--output") { parsed.output = safeOutput(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}
function date(value: string | undefined) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("date must be YYYY-MM-DD"); return value; }
function safeArg(value: string | undefined) { if (!value || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error("invalid filter"); return value; }
function boundedInt(value: string | undefined, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new Error("invalid integer option"); return n; }
function safeOutput(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("output must be a relative json path"); return value; }
function number(value: number | bigint | null) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
function finite(value: number | bigint | null) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function nullableFinite(value: number | null) { return value == null || !Number.isFinite(Number(value)) ? null : Number(value); }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
