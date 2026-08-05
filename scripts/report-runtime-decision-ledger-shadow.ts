import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  reconcileDecisionHistoryRowsToRuntimeLedger,
  type DecisionHistoryShadowRow,
  type RuntimeDecisionLedgerMappingContext,
} from "../src/research/governance/runtimeDecisionLedgerMapper";
import type { RuntimeEvaluationMode } from "../src/research/governance/runtimeDecisionLedger";

type Args = {
  dbPath: string;
  from: string | null;
  to: string | null;
  runKind: string;
  modelVersion: string;
  limit: number;
  output: string | null;
  summaryOnly: boolean;
  lineEligible: boolean;
  context: RuntimeDecisionLedgerMappingContext;
};

function valueAfter(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function required(args: string[], name: string): string {
  const value = valueAfter(args, name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function evaluationModeForRunKind(runKind: string): RuntimeEvaluationMode {
  if (runKind === "paper-live") return "formal_forward";
  if (runKind === "historical-backfill") return "historical";
  if (runKind === "manual-test" || runKind === "sample") return "validation";
  throw new Error(`--evaluation-mode is required for unknown run kind: ${runKind}`);
}

function parseEvaluationMode(value: string | null, runKind: string): RuntimeEvaluationMode {
  const resolved = value ?? evaluationModeForRunKind(runKind);
  const allowed: RuntimeEvaluationMode[] = ["formal_forward", "shadow_forward", "historical", "validation", "future_only"];
  if (!allowed.includes(resolved as RuntimeEvaluationMode)) throw new Error(`invalid --evaluation-mode: ${resolved}`);
  return resolved as RuntimeEvaluationMode;
}

function parseArgs(argv: string[]): Args {
  const runKind = required(argv, "--run-kind");
  const modelVersion = required(argv, "--model-version");
  const from = valueAfter(argv, "--from");
  const to = valueAfter(argv, "--to");
  const limitValue = Number(valueAfter(argv, "--limit") ?? "1000");
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100_000) {
    throw new Error("--limit must be an integer between 1 and 100000");
  }
  const lineEligible = hasFlag(argv, "--line-eligible");
  if (lineEligible && runKind !== "paper-live") throw new Error("--line-eligible is only allowed with --run-kind paper-live");

  const scope = `${modelVersion}:${runKind}:${from ?? "all"}:${to ?? "all"}`;
  return {
    dbPath: resolve(valueAfter(argv, "--db") ?? process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite"),
    from,
    to,
    runKind,
    modelVersion,
    limit: limitValue,
    output: valueAfter(argv, "--output"),
    summaryOnly: hasFlag(argv, "--summary-only"),
    lineEligible,
    context: {
      decisionSystem: valueAfter(argv, "--decision-system") ?? `decision-history-shadow:${runKind}`,
      strategyVersion: valueAfter(argv, "--strategy-version") ?? `shadow:${modelVersion}:${runKind}`,
      featureVersion: valueAfter(argv, "--feature-version") ?? "decision-audit-v1",
      manifestId: valueAfter(argv, "--manifest-id") ?? `decision-history-shadow-manifest:${scope}`,
      cohortId: valueAfter(argv, "--cohort-id") ?? `decision-history-shadow-cohort:${scope}`,
      evaluationMode: parseEvaluationMode(valueAfter(argv, "--evaluation-mode"), runKind),
      lineNotificationEligible: lineEligible,
    },
  };
}

function queryRows(db: DatabaseSync, args: Args): DecisionHistoryShadowRow[] {
  const where = ["dh.run_kind = ?", "dh.model_version = ?"];
  const params: Array<string | number> = [args.runKind, args.modelVersion];
  if (args.from) {
    where.push("dh.date >= ?");
    params.push(args.from);
  }
  if (args.to) {
    where.push("dh.date <= ?");
    params.push(args.to);
  }
  params.push(args.limit);

  return db.prepare(`
SELECT
  dh.id,
  dh.race_id,
  dh.date,
  dh.venue,
  dh.race_no,
  dh.bet_type,
  dh.selection,
  dh.estimated_hit_rate,
  dh.raw_estimated_hit_rate,
  dh.required_odds,
  dh.current_odds,
  dh.ev,
  dh.decision,
  dh.recommended_stake_yen,
  dh.sample_size,
  dh.model_version,
  dh.run_kind,
  dh.source,
  dh.fetched_at,
  dh.created_at,
  dh.decision_reasons,
  dh.feature_adjustment,
  dh.feature_adjustment_breakdown,
  p.close_at,
  p.imported_at AS program_imported_at
FROM decision_history dh
LEFT JOIN official_programs p ON p.race_id = dh.race_id
WHERE ${where.join(" AND ")}
ORDER BY dh.id ASC
LIMIT ?
`).all(...params) as DecisionHistoryShadowRow[];
}

function atomicWrite(path: string, contents: string): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temp = `${absolute}.tmp-${process.pid}`;
  writeFileSync(temp, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, absolute);
}

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/report-runtime-decision-ledger-shadow.ts \\",
    "    --run-kind paper-live --model-version <version> [options]",
    "",
    "Options:",
    "  --db <path>                 default: BOAT_PON_DB_PATH or data/boat.sqlite",
    "  --from YYYY-MM-DD --to YYYY-MM-DD",
    "  --limit <1..100000>         default: 1000",
    "  --output <path>             atomic mode-0600 JSON output",
    "  --summary-only              omit mapped records from printed/output JSON",
    "  --line-eligible             paper-live only; records eligibility, never sends LINE",
    "  --evaluation-mode <mode>    inferred for known run kinds",
    "  --decision-system <id> --strategy-version <id> --feature-version <id>",
    "  --manifest-id <id> --cohort-id <id>",
    "",
    "This command opens SQLite read-only and enables PRAGMA query_only. It never changes BUY, LINE, or DB state.",
  ].join("\n");
}

function main(): void {
  if (hasFlag(process.argv, "--help")) {
    console.log(usage());
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.dbPath)) throw new Error(`DB not found: ${args.dbPath}`);

  const db = new DatabaseSync(args.dbPath, { readOnly: true });
  db.exec("PRAGMA query_only = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  try {
    const rows = queryRows(db, args);
    const reconciliation = reconcileDecisionHistoryRowsToRuntimeLedger(rows, args.context);
    const payload = {
      schemaVersion: "runtime-decision-ledger-shadow-report.0.1",
      generatedAt: new Date().toISOString(),
      source: {
        dbPath: args.dbPath,
        queryOnly: true,
        runKind: args.runKind,
        modelVersion: args.modelVersion,
        from: args.from,
        to: args.to,
        limit: args.limit,
      },
      context: args.context,
      reconciliation: args.summaryOnly
        ? { ...reconciliation, records: [] }
        : reconciliation,
    };
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    if (args.output) atomicWrite(args.output, json);
    console.log(json.trimEnd());
    if (reconciliation.status === "FAILED") process.exitCode = 2;
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
