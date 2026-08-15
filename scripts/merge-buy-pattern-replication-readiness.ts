import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validateBuyLearningSummary, type BuyLearningSummary } from "../src/presentation/buyLearningSummary";

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.summary) || !existsSync(args.replication)) throw new Error("BUY replication readiness inputs are unavailable");

const summary = JSON.parse(await readFile(args.summary, "utf8")) as BuyLearningSummary;
const summaryErrors = validateBuyLearningSummary(summary);
if (summaryErrors.length) throw new Error(`BUY learning summary invalid: ${summaryErrors.join("; ")}`);
const replication = validateReplication(JSON.parse(await readFile(args.replication, "utf8")) as unknown);

if (summary.status === "AVAILABLE") {
  const settled = summary.performance.settled;
  if (settled === null || settled !== replication.totalSettled) throw new Error("BUY replication/learning settled count mismatch");
  const readiness = readinessLearning(replication);
  const next = {
    ...summary,
    learnings: [...summary.learnings.filter((item) => !item.id.startsWith("PATTERN_REPLICATION_")), readiness].slice(0, 6),
  };
  const errors = validateBuyLearningSummary(next);
  if (errors.length) throw new Error(`BUY replication-enriched summary invalid: ${errors.join("; ")}`);
  await atomicWrite(args.summary, `${JSON.stringify(next, null, 2)}\n`);
  console.log(JSON.stringify({
    status: next.status,
    replicationStatus: replication.status,
    totalSettled: replication.totalSettled,
    requiredSettled: replication.requiredSettled,
    missingSettledToCompare: replication.missingSettledToCompare,
    readinessLearningId: readiness.id,
    productionChangeAllowed: false,
  }));
} else {
  console.log(JSON.stringify({ status: summary.status, replicationStatus: replication.status, readinessLearningId: null, productionChangeAllowed: false }));
}

type Replication = {
  status: "INSUFFICIENT_WINDOW_SUPPORT" | "NO_REPLICATED_SIGNAL" | "REPLICATED_SIGNALS";
  totalSettled: number;
  windowSize: number;
  requiredSettled: number;
  missingSettledToCompare: number;
  replicatedPatternCount: number;
  signals: unknown[];
  productionChangeAllowed: false;
};

function readinessLearning(replication: Replication): BuyLearningSummary["learnings"][number] {
  if (replication.status === "INSUFFICIENT_WINDOW_SUPPORT") {
    return {
      id: "PATTERN_REPLICATION_PENDING",
      severity: "INFO",
      title: "Pattern再現確認は母数待ち",
      summary: `独立${replication.windowSize}件×2 windowで同一条件・同一方向の再現を確認してから学習signalへ昇格します。現在${replication.totalSettled}/${replication.requiredSettled}件、あと${replication.missingSettledToCompare}件です。`,
      evidenceCount: replication.totalSettled,
    };
  }
  if (replication.status === "NO_REPLICATED_SIGNAL") {
    return {
      id: "PATTERN_REPLICATION_NONE",
      severity: "INFO",
      title: "独立windowで反復するPatternなし",
      summary: `独立${replication.windowSize}件×2 windowを満たしましたが、同一条件・同一方向で再現する成功/失敗patternは確認されていません。探索結果をproductionへ昇格しません。`,
      evidenceCount: replication.totalSettled,
    };
  }
  return {
    id: "PATTERN_REPLICATION_CONFIRMED",
    severity: "WATCH",
    title: "独立windowでPattern再現を確認",
    summary: `${replication.replicatedPatternCount}件のprivate patternが独立${replication.windowSize}件×2 windowで同方向に再現しました。具体条件はprivate evidenceに保持し、追加研究前にはproductionへ反映しません。`,
    evidenceCount: replication.totalSettled,
  };
}

function validateReplication(value: unknown): Replication {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid BUY pattern replication report");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "generatedAt", "status", "totalSettled", "windowSize", "requiredSettled", "missingSettledToCompare", "discoveryPatternCount", "confirmationPatternCount", "replicatedPatternCount", "signals", "productionChangeAllowed"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`unknown BUY replication key: ${key}`);
  if (raw.schemaVersion !== "buy-pattern-replication-public-v1" || raw.productionChangeAllowed !== false) throw new Error("invalid BUY pattern replication identity");
  if (!["INSUFFICIENT_WINDOW_SUPPORT", "NO_REPLICATED_SIGNAL", "REPLICATED_SIGNALS"].includes(String(raw.status))) throw new Error("invalid BUY pattern replication status");
  for (const key of ["totalSettled", "windowSize", "requiredSettled", "missingSettledToCompare", "replicatedPatternCount"] as const) {
    if (!Number.isInteger(raw[key]) || Number(raw[key]) < 0) throw new Error(`invalid BUY pattern replication ${key}`);
  }
  if (Number(raw.windowSize) < 1 || Number(raw.requiredSettled) !== Number(raw.windowSize) * 2) throw new Error("invalid BUY pattern replication window contract");
  if (Number(raw.missingSettledToCompare) !== Math.max(0, Number(raw.requiredSettled) - Number(raw.totalSettled))) throw new Error("BUY pattern replication support delta mismatch");
  if (!Array.isArray(raw.signals)) throw new Error("invalid BUY pattern replication signals");
  if (raw.status === "INSUFFICIENT_WINDOW_SUPPORT" && (Number(raw.missingSettledToCompare) === 0 || raw.signals.length > 0)) throw new Error("invalid insufficient BUY pattern replication state");
  if (raw.status === "NO_REPLICATED_SIGNAL" && (Number(raw.missingSettledToCompare) !== 0 || raw.signals.length > 0)) throw new Error("invalid no-signal BUY pattern replication state");
  if (raw.status === "REPLICATED_SIGNALS" && (Number(raw.missingSettledToCompare) !== 0 || raw.signals.length === 0)) throw new Error("invalid confirmed BUY pattern replication state");
  return raw as unknown as Replication;
}

function parseArgs(argv: string[]) {
  const parsed = { summary: null as string | null, replication: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--summary") { parsed.summary = safeJson(value); i += 1; }
    else if (key === "--replication") { parsed.replication = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!parsed.summary || !parsed.replication) throw new Error("summary and replication are required");
  return parsed as { summary: string; replication: string };
}
function safeJson(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file"); return value; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
