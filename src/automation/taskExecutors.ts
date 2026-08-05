// boat-pon task executor registry（allowlist のみ・arbitrary shell 禁止）。
// executor は実 sidecarをread-onlyで扱い、production/BUY/app_settingsへ接続しない。
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "../research-replay/canonical";
import {
  N2_DATASET_CONTRACT_VERSION, N2_FEATURE_PIT_CONTRACT_VERSION, N2_TARGET_CONTRACT_VERSION,
} from "../research-replay/n2DatasetContract";
import {
  atomicWriteJson, runExecutorLifecycle, verifyJsonReadback, type ExecutorSpec, type SdkContext,
} from "../research/governance/executorSdk";
import { appendRecordIdempotent } from "../research/governance/registryStore";

export const EXECUTOR_REGISTRY_VERSION = "n2-task-executor-registry-v2";

export type ExecutorResult = {
  // DRY_RUN_OK は SDK 経由 executor を dry-run で呼んだ場合のみ（runner は dry-run で executor を呼ばない）。
  // queue-state を PASS へ遷移させない非永続結果。
  result: "PASS" | "DRY_RUN_OK" | "CONDITIONAL" | "BLOCKED" | "FAILED";
  executorVersion: string;
  summary: Record<string, unknown>;
  outputs: string[];
  outputDigest: string;
  blocks: string[];
};

export type ExecutorContext = {
  repoRoot: string;
  runId: string;
  requestId: string;
  taskId: string;
  sidecarPath: string;
  historyDir: string;
  reportsDir: string;
  dryRun: boolean;
  taskStatuses: Record<string, string>;
  mergedTasks?: Array<{
    taskId: string; status: string; taskType: string; defaultStatus?: string; dependencies?: string[];
    title?: string; objective?: string; safetyLevel?: string;
  }>;
  controlDir?: string;
};

export type Executor = (ctx: ExecutorContext) => ExecutorResult;

function openReadOnly(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  return db;
}

function assertQuiescent(sidecarPath: string): string[] {
  const blocks: string[] = [];
  if (!existsSync(sidecarPath)) blocks.push("SIDECAR_NOT_FOUND");
  const wal = `${sidecarPath}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) blocks.push("ACTIVE_WAL");
  return blocks;
}

// Runtimeではnullを返し得るため全callerが明示guardする。戻り型anyはguard後の既存契約を維持するための境界型。
function loadFreeze(repoRoot: string): any {
  const path = join(repoRoot, "reports/n2/corrected-settlement-truth-freeze.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const HELD_OUT_RACES = ["2014-03-28:08:R1", "2014-03-28:17:R2"] as const;
const HELD_OUT_KEYS = new Set(HELD_OUT_RACES.map((r) => `${r}|win`));
const HOLDOUT_SET_ID = "n2-win-refund-omission-holdout-v1";

export const CANARY_COHORT = {
  definition: "fixed-month cohort: 2024-06 (deterministic, no random sampling)",
  fromRaceKey: "2024-06-01:",
  toRaceKeyExclusive: "2024-07-01:",
} as const;

function blocked(blocks: string[]): ExecutorResult {
  return { result: "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary: { blocks }, outputs: [], outputDigest: canonicalHash({ blocks }), blocks };
}

function writeReport(ctx: ExecutorContext, name: string, summary: Record<string, unknown>, outputDigest: string): string[] {
  if (ctx.dryRun) return [];
  const relative = `reports/n2/${name}`;
  const payload = {
    ...summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId,
    executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest,
  };
  atomicWriteJson(join(ctx.repoRoot, relative), payload, true);
  const verified = verifyJsonReadback(join(ctx.repoRoot, relative), outputDigest);
  if (!verified.ok) throw new Error(verified.errors.join("; "));
  return [relative];
}

export const runDatasetCanary: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length) return blocked(blocks);
  const db = openReadOnly(ctx.sidecarPath);
  try {
    const rows = db.prepare(`
      SELECT c.canonical_race_key k, c.bet_type b, c.settlement_status s, c.result_kind rk, c.parse_run_id pr
      FROM settlement_candidates_v2 c
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
        AND NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)
        AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id)
    `).all(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as Array<{ k: string; b: string; s: string; rk: string; pr: string }>;
    const sourceDuplicateCount = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 c
      WHERE c.canonical_race_key>=? AND c.canonical_race_key<?
      AND EXISTS(SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)`)
      .get(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as { n: number }).n);
    const supersededCount = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 c
      WHERE c.canonical_race_key>=? AND c.canonical_race_key<?
      AND EXISTS(SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id)`)
      .get(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as { n: number }).n);
    const correctedCount = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 c JOIN parse_runs p ON p.parse_run_id=c.parse_run_id
      WHERE c.canonical_race_key>=? AND c.canonical_race_key<? AND p.parser_name='n2-settlement-reparse'
      AND NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id)`)
      .get(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as { n: number }).n);
    const races = new Set<string>();
    const exclusions: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byBetType: Record<string, number> = {};
    let eligible = 0, heldOutExcluded = 0;
    for (const row of rows) {
      races.add(row.k);
      byStatus[row.s] = (byStatus[row.s] ?? 0) + 1;
      byBetType[row.b] = (byBetType[row.b] ?? 0) + 1;
      if (HELD_OUT_KEYS.has(`${row.k}|${row.b}`)) { heldOutExcluded += 1; exclusions.held_out_win_refund_omission = (exclusions.held_out_win_refund_omission ?? 0) + 1; continue; }
      if (["refunded", "cancelled", "no_sale", "pending"].includes(row.s)) { exclusions[`excluded_${row.s}`] = (exclusions[`excluded_${row.s}`] ?? 0) + 1; continue; }
      eligible += 1;
    }
    const total = rows.length;
    const summary = {
      datasetContractVersion: N2_DATASET_CONTRACT_VERSION,
      targetContractVersion: N2_TARGET_CONTRACT_VERSION,
      featurePitContractVersion: N2_FEATURE_PIT_CONTRACT_VERSION,
      correctedTruthVersion: freeze.correctedTruthVersion,
      sourceSettlementIdentity: freeze.settlementSnapshotIdentityAfter,
      cohort: CANARY_COHORT,
      raceCount: races.size,
      candidateCount: total,
      correctedTruthCandidates: correctedCount,
      eligibleCount: eligible,
      excludedCount: total - eligible,
      exclusionReasons: exclusions,
      heldOutExcluded,
      holdoutSetId: HOLDOUT_SET_ID,
      sourceDuplicateExcluded: sourceDuplicateCount,
      supersededExcluded: supersededCount,
      eligibleRate: total ? eligible / total : null,
      byStatus, byBetType,
      pit: { mode: "historical", featureSourcesRead: [], postRaceFeatureRead: false, result: "PASS" },
      leakage: { sameRaceLabelBorrow: false, futureCandidateRead: false, result: "PASS" },
      timeSplit: { policy: "fixed canary month; not a train/test split" },
      featureAvailability: "NOT_APPLICABLE",
    };
    const outputDigest = canonicalHash(summary);
    if (!total) return { ...blocked(["EMPTY_COHORT"]), summary, outputDigest };
    const outputs = writeReport(ctx, "n2-dataset-canary.json", summary, outputDigest);
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

export const runReadonlyAnalysis: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  if (ctx.taskStatuses["TASK-N2-001"] !== "PASS") blocks.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-001=${ctx.taskStatuses["TASK-N2-001"] ?? "UNKNOWN"}`);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length) return blocked(blocks);
  const db = openReadOnly(ctx.sidecarPath);
  try {
    const byYearRows = db.prepare(`SELECT substr(c.canonical_race_key,1,4)y,c.settlement_status s,COUNT(*)n FROM settlement_candidates_v2 c
      WHERE NOT EXISTS(SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)
      AND NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id) GROUP BY 1,2 ORDER BY 1,2`)
      .all() as Array<{ y: string; s: string; n: number }>;
    const byBetRows = db.prepare(`SELECT c.bet_type b,c.settlement_status s,COUNT(*)n FROM settlement_candidates_v2 c
      WHERE NOT EXISTS(SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)
      AND NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id) GROUP BY 1,2 ORDER BY 1,2`)
      .all() as Array<{ b: string; s: string; n: number }>;
    const byYear: Record<string, { total: number; settled: number; refunded: number; eligibleRate: number }> = {};
    for (const row of byYearRows) {
      const a = byYear[row.y] ?? { total: 0, settled: 0, refunded: 0, eligibleRate: 0 };
      a.total += Number(row.n); if (row.s === "settled") a.settled += Number(row.n); if (row.s === "refunded") a.refunded += Number(row.n); byYear[row.y] = a;
    }
    for (const a of Object.values(byYear)) a.eligibleRate = a.total ? a.settled / a.total : 0;
    const byBetType: Record<string, { total: number; settled: number; refunded: number }> = {};
    for (const row of byBetRows) {
      const a = byBetType[row.b] ?? { total: 0, settled: 0, refunded: 0 };
      a.total += Number(row.n); if (row.s === "settled") a.settled += Number(row.n); if (row.s === "refunded") a.refunded += Number(row.n); byBetType[row.b] = a;
    }
    const totals = Object.values(byYear).reduce((a, x) => ({ total: a.total + x.total, settled: a.settled + x.settled, refunded: a.refunded + x.refunded }), { total: 0, settled: 0, refunded: 0 });
    const correctedEligibleRate = totals.total ? totals.settled / totals.total : null;
    const summary = {
      correctedTruthVersion: freeze.correctedTruthVersion, sourceSettlementIdentity: freeze.settlementSnapshotIdentityAfter,
      correctedEligibleRate, totals, byYear, byBetType, forwardResultClaim: false,
      legacyComparison: { legacyEligibleRate: 0.9603, deltaPoints: correctedEligibleRate === null ? null : (correctedEligibleRate - 0.9603) * 100 },
    };
    const outputDigest = canonicalHash(summary);
    const outputs = writeReport(ctx, "n2-corrected-eligibility.json", summary, outputDigest);
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

export const runReadonlyAudit: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  const auditPath = join(ctx.repoRoot, "reports/n2/unexpected-additions-audit.json");
  if (!existsSync(auditPath)) blocks.push("UNEXPECTED_ADDITIONS_AUDIT_MISSING");
  if (blocks.length) return blocked(blocks);
  const audit = JSON.parse(readFileSync(auditPath, "utf8"));
  const db = openReadOnly(ctx.sidecarPath);
  try {
    const winMissing = Number((db.prepare(`SELECT COUNT(*)n FROM(SELECT DISTINCT c.canonical_race_key k FROM settlement_candidates_v2 c
      WHERE NOT EXISTS(SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)
      AND NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id))r
      WHERE NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 w WHERE w.canonical_race_key=r.k AND w.bet_type='win'
      AND NOT EXISTS(SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d2 WHERE d2.duplicate_observation_id=w.observation_id)
      AND NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 s3 WHERE s3.supersedes_candidate_id=w.candidate_id))`).get() as { n: number }).n);
    const lineage = (audit.findings ?? []).map((f: any) => ({ raceKey: f.raceKey, betType: f.betType, classification: f.classification, rawDocumentId: f.rawDocumentId, rawSha256: f.rawSha256 }));
    const summary = {
      heldOutCount: lineage.length, lineage, impactScan: { racesWithoutActiveWinCandidate: winMissing },
      autoCorrectionPossible: false, separateApprovalRequired: true, proposedDefectCode: "V1_WIN_REFUND_OMISSION",
      productionApplyExecuted: false,
    };
    const outputDigest = canonicalHash(summary);
    const outputs = writeReport(ctx, "n2-win-refund-omission-audit.json", summary, outputDigest);
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

export const runDatasetInventory: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length) return blocked(blocks);
  const db = openReadOnly(ctx.sidecarPath);
  try {
    const active = `LEFT JOIN settlement_source_duplicate_resolutions_v2 d ON d.duplicate_observation_id=c.observation_id
      WHERE d.duplicate_observation_id IS NULL AND NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id)`;
    const byYearRows = db.prepare(`SELECT substr(c.canonical_race_key,1,4)y,COUNT(*)n,COUNT(DISTINCT c.canonical_race_key)r FROM settlement_candidates_v2 c ${active} GROUP BY 1 ORDER BY 1`)
      .all() as Array<{ y: string; n: number; r: number }>;
    const byBetRows = db.prepare(`SELECT c.bet_type b,COUNT(*)n FROM settlement_candidates_v2 c ${active} GROUP BY 1 ORDER BY 1`).all() as Array<{ b: string; n: number }>;
    const totalActiveCandidates = byYearRows.reduce((s, r) => s + Number(r.n), 0);
    const totalRaces = byYearRows.reduce((s, r) => s + Number(r.r), 0);
    const summary = {
      correctedTruthVersion: freeze.correctedTruthVersion, sourceSettlementIdentity: freeze.settlementSnapshotIdentityAfter,
      totalActiveCandidates, totalRaces, yearCount: byYearRows.length,
      byYear: Object.fromEntries(byYearRows.map((r) => [r.y, { candidates: Number(r.n), races: Number(r.r) }])),
      byBetType: Object.fromEntries(byBetRows.map((r) => [r.b, Number(r.n)])), readOnly: true,
    };
    const outputDigest = canonicalHash(summary);
    if (!totalActiveCandidates) return { ...blocked(["EMPTY_INVENTORY"]), summary, outputDigest };
    const outputs = writeReport(ctx, "n2-dataset-inventory.json", summary, outputDigest);
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

export const runHoldoutFreeze: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  if (ctx.taskStatuses["TASK-N2-004"] !== "PASS") blocks.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-004=${ctx.taskStatuses["TASK-N2-004"] ?? "UNKNOWN"}`);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length) return blocked(blocks);
  const summary = {
    holdoutContractVersion: "n2-holdout-freeze-v2", correctedTruthVersion: freeze.correctedTruthVersion,
    untouchedHoldoutRaces: HELD_OUT_RACES, holdoutSetId: HOLDOUT_SET_ID,
    timeSplit: {
      policy: "time-based race-level group split; boundaries are half-open and non-overlapping",
      train: { fromRaceKeyInclusive: null, toRaceKeyExclusive: "2022-01-01:" },
      validation: { fromRaceKeyInclusive: "2022-01-01:", toRaceKeyExclusive: "2024-01-01:" },
      test: { fromRaceKeyInclusive: "2024-01-01:", toRaceKeyExclusive: "2026-01-01:" },
      forwardShadow: { fromRaceKeyInclusive: "2026-01-01:", toRaceKeyExclusive: null },
    },
    productionApplyExecuted: false,
  };
  const outputDigest = canonicalHash(summary);
  const outputs = writeReport(ctx, "n2-holdout-freeze.json", summary, outputDigest);
  return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
};

export const runFeatureCoverageAudit: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  if (ctx.taskStatuses["TASK-N2-004"] !== "PASS") blocks.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-004=${ctx.taskStatuses["TASK-N2-004"] ?? "UNKNOWN"}`);
  if (blocks.length) return blocked(blocks);
  const db = openReadOnly(ctx.sidecarPath);
  try {
    const settled = Number((db.prepare("SELECT COUNT(*)n FROM settlement_candidates_v2 WHERE settlement_status='settled'").get() as { n: number }).n);
    const refunded = Number((db.prepare("SELECT COUNT(*)n FROM settlement_candidates_v2 WHERE settlement_status='refunded'").get() as { n: number }).n);
    const withPayout = Number((db.prepare(`SELECT COUNT(DISTINCT c.candidate_id)n FROM settlement_candidates_v2 c JOIN race_payout_lines_v2 p ON p.candidate_id=c.candidate_id WHERE c.settlement_status='settled'`).get() as { n: number }).n);
    const withRefund = Number((db.prepare(`SELECT COUNT(DISTINCT c.candidate_id)n FROM settlement_candidates_v2 c JOIN race_refund_lines_v2 r ON r.candidate_id=c.candidate_id WHERE c.settlement_status='refunded'`).get() as { n: number }).n);
    const summary = {
      auditContractVersion: "n2-settlement-coverage-v1", settledCandidates: settled, settledWithPayoutLines: withPayout,
      payoutLineCoverage: settled ? withPayout / settled : null, refundedCandidates: refunded, refundedWithRefundLines: withRefund,
      refundLineCoverage: refunded ? withRefund / refunded : null,
      missingness: { settledMissingPayoutLines: settled - withPayout, refundedMissingRefundLines: refunded - withRefund }, readOnly: true,
    };
    const outputDigest = canonicalHash(summary);
    const outputs = writeReport(ctx, "n2-feature-coverage-audit.json", summary, outputDigest);
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

export const runPlannerNext: Executor = (ctx) => {
  const merged = ctx.mergedTasks ?? [];
  const readyCount = merged.filter((t) => t.status === "READY" && t.taskId !== "TASK-PLANNER-NEXT").length;
  const pending = readyCount > 0 ? [] : merged.filter((t) => t.status === "BLOCKED_EXECUTOR_PENDING");
  const candidates = pending.map((t, i) => ({
    candidateId: `CAND-${ctx.runId}-${i + 1}`, proposedTaskId: t.taskId, title: t.title ?? t.taskId,
    objective: t.objective ?? "", taskType: t.taskType, executorType: t.taskType, safetyLevel: t.safetyLevel ?? "L0",
    dependencies: t.dependencies ?? [], reason: "ENGINEERING_REQUIRED", duplicateCheck: "catalog taskId",
  }));
  const normalized = candidates.map((c) => ({ proposedTaskId: c.proposedTaskId, taskType: c.taskType, dependencies: c.dependencies }));
  const dir = ctx.controlDir ?? join(ctx.repoRoot, "automation/control");
  const previousPath = join(dir, "planner-candidates.json");
  let noChangeEngineeringRequired = false;
  if (existsSync(previousPath)) {
    try {
      const previous = JSON.parse(readFileSync(previousPath, "utf8"));
      const oldNormalized = (previous.candidates ?? []).map((c: any) => ({ proposedTaskId: c.proposedTaskId, taskType: c.taskType, dependencies: c.dependencies ?? [] }));
      noChangeEngineeringRequired = readyCount === 0 && canonicalHash(oldNormalized) === canonicalHash(normalized);
    } catch { noChangeEngineeringRequired = false; }
  }
  const summary = {
    plannerVersion: "n2-planner-v2", readyTaskCount: readyCount, blockedExecutorPendingCount: pending.length,
    candidateCount: candidates.length, candidates, autoDispatch: false, noChangeEngineeringRequired,
    status: noChangeEngineeringRequired ? "NO_CHANGE_ENGINEERING_REQUIRED" : "CANDIDATES_UPDATED",
  };
  const outputDigest = canonicalHash({ ...summary, candidates: normalized });
  if (ctx.dryRun || noChangeEngineeringRequired) {
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs: [], outputDigest, blocks: [] };
  }
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(previousPath, { plannerCandidatesSchemaVersion: "planner-candidates-v2", ...summary, runId: ctx.runId, requestId: ctx.requestId, generatedAt: new Date().toISOString(), outputDigest }, true);
  const verified = verifyJsonReadback(previousPath, outputDigest);
  if (!verified.ok) return { result: "FAILED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs: [], outputDigest, blocks: verified.errors };
  return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs: ["automation/control/planner-candidates.json"], outputDigest, blocks: [] };
};

export const runDatasetExpand: Executor = (ctx) => {
  const reportRel = "reports/n2/n2-dataset-manifest.json";
  const sdkCtx: SdkContext = {
    repoRoot: ctx.repoRoot, runId: ctx.runId, taskId: ctx.taskId, dataRoot: ctx.sidecarPath,
    dryRun: ctx.dryRun, writeAllowlist: ["reports/n2/", "research/registries/"],
  };
  let expRecord: Record<string, unknown> | null = null;
  let discRecord: Record<string, unknown> | null = null;
  const spec: ExecutorSpec = {
    name: "dataset-expand", safetyLevel: "L0", implemented: true,
    inputContract: () => {
      const errors = assertQuiescent(ctx.sidecarPath);
      if (ctx.taskStatuses["TASK-N2-004"] !== "PASS") errors.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-004=${ctx.taskStatuses["TASK-N2-004"] ?? "UNKNOWN"}`);
      if (!loadFreeze(ctx.repoRoot)) errors.push("CORRECTED_TRUTH_FREEZE_MISSING");
      return { ok: errors.length === 0, errors };
    },
    executeReadOnly: () => {
      const freeze = loadFreeze(ctx.repoRoot)!;
      const db = openReadOnly(ctx.sidecarPath);
      try {
        const rows = db.prepare(`WITH active AS (
          SELECT c.canonical_race_key k,c.bet_type b FROM settlement_candidates_v2 c
          LEFT JOIN settlement_source_duplicate_resolutions_v2 d ON d.duplicate_observation_id=c.observation_id
          WHERE d.duplicate_observation_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id=c.candidate_id)
        ) SELECT substr(k,1,4)y,
          COUNT(*) inventoryCandidates,COUNT(DISTINCT k) inventoryRaces,
          SUM(CASE WHEN NOT((k=? AND b='win') OR (k=? AND b='win')) THEN 1 ELSE 0 END) eligibleCandidates,
          COUNT(DISTINCT CASE WHEN NOT((k=? AND b='win') OR (k=? AND b='win')) THEN k END) eligibleRaces,
          SUM(CASE WHEN ((k=? AND b='win') OR (k=? AND b='win')) THEN 1 ELSE 0 END) holdoutCandidatesPresent
          FROM active GROUP BY 1 ORDER BY 1`)
          .all(HELD_OUT_RACES[0], HELD_OUT_RACES[1], HELD_OUT_RACES[0], HELD_OUT_RACES[1], HELD_OUT_RACES[0], HELD_OUT_RACES[1]) as Array<{
            y: string; inventoryCandidates: number; inventoryRaces: number; eligibleCandidates: number; eligibleRaces: number; holdoutCandidatesPresent: number;
          }>;
        const inventoryTotals = rows.reduce((a, r) => ({ candidates: a.candidates + Number(r.inventoryCandidates), races: a.races + Number(r.inventoryRaces) }), { candidates: 0, races: 0 });
        const researchEligibleTotals = rows.reduce((a, r) => ({ candidates: a.candidates + Number(r.eligibleCandidates), races: a.races + Number(r.eligibleRaces) }), { candidates: 0, races: 0 });
        const holdoutCandidatesPresent = rows.reduce((s, r) => s + Number(r.holdoutCandidatesPresent), 0);
        const years = rows.map((r) => r.y);
        const manifest = {
          datasetManifestVersion: "n2-dataset-manifest-v2",
          datasetVersion: `n2-corrected-${years[0] ?? "na"}_${years.at(-1) ?? "na"}`,
          correctedTruthVersion: freeze.correctedTruthVersion,
          sourceSettlementIdentity: freeze.settlementSnapshotIdentityAfter,
          inventoryTotals,
          researchEligibleTotals,
          totalActiveCandidates: inventoryTotals.candidates,
          totalRaces: inventoryTotals.races,
          yearSpan: years.length ? { from: years[0], to: years.at(-1), count: years.length } : null,
          byYear: Object.fromEntries(rows.map((r) => [r.y, {
            inventory: { candidates: Number(r.inventoryCandidates), races: Number(r.inventoryRaces) },
            researchEligible: { candidates: Number(r.eligibleCandidates), races: Number(r.eligibleRaces) },
          }])),
          holdoutSetId: HOLDOUT_SET_ID,
          holdoutSetDigest: canonicalHash(HELD_OUT_RACES.map((race) => `${race}|win`)),
          holdoutCount: HELD_OUT_RACES.length,
          holdoutCandidatesPresent,
          holdoutExcludedFromResearchCohort: true,
          splitProtocolVersion: "n2-time-split-v2",
          splitBoundaries: {
            train: { fromInclusive: null, toExclusive: "2022-01-01:" },
            validation: { fromInclusive: "2022-01-01:", toExclusive: "2024-01-01:" },
            test: { fromInclusive: "2024-01-01:", toExclusive: "2026-01-01:" },
            forwardShadow: { fromInclusive: "2026-01-01:", toExclusive: null },
          },
          readOnly: true,
        };
        const digest = canonicalHash(manifest);
        const stableCreatedAt = String(freeze.frozenAt ?? "2026-08-03T14:07:04.991Z");
        const expId = `EXP-dataset-expand-${digest.slice(0, 8)}`;
        const discId = `DISC-dataset-coverage-${digest.slice(0, 8)}`;
        expRecord = {
          experimentId: expId, researchQuestion: "corrected datasetの全期間coverageとsplitを固定できるか",
          rationale: "baseline前提のmanifestを固定する", hypothesis: "corrected truthは全期間を安定coverageする",
          dataSnapshot: manifest.datasetVersion, trialFamilyId: "TF-dataset-foundation", totalTrialCount: 1, testedConditions: 1,
          discoveryPeriod: "inventory-all", validationPeriod: "not-applicable", holdoutPolicy: HOLDOUT_SET_ID,
          primaryMetric: "coverage", secondaryMetrics: ["race_count"], minimumSample: 1, stoppingRule: "single deterministic manifest",
          successCondition: "non-empty manifest", rejectionCondition: "empty cohort", multiplicityFamily: "TF-dataset-foundation",
          evidenceStage: "exploration", status: "completed", createdAt: stableCreatedAt,
        };
        discRecord = {
          discoveryId: discId, sourceExperimentIds: [expId], sourceStrategyId: null, sourceStrategyVersion: null,
          finding: `corrected dataset inventory=${inventoryTotals.races} races/${inventoryTotals.candidates} candidates; eligible=${researchEligibleTotals.races}/${researchEligibleTotals.candidates}`,
          mechanismHypothesis: "settlement reparseによる訂正済みtruth", evidenceLevel: "strong", shareClass: "GLOBAL_FACT",
          scope: "全期間・全券種", knownConfounders: [], trialFamilyId: "TF-dataset-foundation", trialCountAtDiscovery: 1,
          adoptedBy: [], rejectedBy: [], createdAt: stableCreatedAt,
        };
        return { outputs: [reportRel], digest, summary: manifest };
      } finally { db.close(); }
    },
    pitEvidence: (_sdk, art) => ({
      status: "NOT_APPLICABLE", validatorId: "settlement-inventory-pit-applicability", validatorVersion: "v1",
      checkedRecordCount: Number((art.summary.inventoryTotals as any).candidates), sameRaceViolationCount: 0,
      futureViolationCount: 0, ambiguousTimingCount: 0, evidencePath: null, evidenceDigest: null,
      notApplicableReason: "settlement inventory does not join prediction-time features",
    }),
    writeArtifacts: (sdk, art) => {
      try {
        const payload = {
          ...art.summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId,
          executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest: art.digest,
        };
        atomicWriteJson(join(sdk.repoRoot, reportRel), payload, true);
        return { ok: true, errors: [], outputs: [reportRel] };
      } catch (e) { return { ok: false, errors: [e instanceof Error ? e.message : String(e)] }; }
    },
    verifyArtifacts: (sdk, art) => verifyJsonReadback(join(sdk.repoRoot, reportRel), art.digest),
    recordEvidence: (sdk, _art, outputs) => {
      if (!expRecord || !discRecord) return { ok: false, errors: ["evidence records not prepared"] };
      const regRoot = join(sdk.repoRoot, "research/registries");
      const exp = appendRecordIdempotent(regRoot, "experiments", expRecord);
      if (!exp.ok) return { ok: false, errors: [`experiment ${exp.code}: ${exp.errors.join("; ")}`], outputs };
      const disc = appendRecordIdempotent(regRoot, "discoveries", discRecord);
      if (!disc.ok) return { ok: false, errors: [`discovery ${disc.code}: ${disc.errors.join("; ")}`], outputs: [...outputs, exp.path!].filter(Boolean) };
      const rel = (path: string | undefined) => path ? path.replace(`${sdk.repoRoot}/`, "") : "";
      return { ok: true, errors: [], outputs: [...outputs, rel(exp.path), rel(disc.path)].filter(Boolean) };
    },
    // queue-state は変更しない（外部 orchestrator=runner が単独で担当）。evidence 完成の確認のみ。
    finalizeEvidence: (_sdk, _art, outputs) => ({ ok: true, errors: [], outputs }),
  };
  const outcome = runExecutorLifecycle(spec, sdkCtx);
  const result: ExecutorResult["result"] = outcome.result === "ENGINEERING_REQUIRED" ? "BLOCKED" : outcome.result;
  return {
    result, executorVersion: EXECUTOR_REGISTRY_VERSION, summary: outcome.summary, outputs: outcome.outputs,
    outputDigest: outcome.digest || canonicalHash(outcome.summary), blocks: outcome.blocks,
  };
};

export const EXECUTORS: Readonly<Record<string, Executor>> = Object.freeze({
  "dataset-canary": runDatasetCanary,
  "readonly-analysis": runReadonlyAnalysis,
  "readonly-audit": runReadonlyAudit,
  "dataset-inventory": runDatasetInventory,
  "holdout-freeze": runHoldoutFreeze,
  "feature-coverage-audit": runFeatureCoverageAudit,
  "planner-next": runPlannerNext,
  "dataset-expand": runDatasetExpand,
});

export const KNOWN_TASK_TYPES = [
  "dataset-canary", "readonly-analysis", "readonly-audit", "dataset-inventory", "holdout-freeze",
  "feature-coverage-audit", "planner-next", "dataset-expand",
  "pit-audit", "baseline-market", "baseline-historical", "baseline-common-cohort",
  "evaluation-metrics", "edge-hypothesis-scan", "edge-historical-test", "confounder-audit",
] as const;

export function isExecutorImplemented(taskType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXECUTORS, taskType);
}

export function resolveExecutor(taskType: string): { executor: Executor | null; code: "OK" | "EXECUTOR_NOT_REGISTERED" } {
  const executor = Object.prototype.hasOwnProperty.call(EXECUTORS, taskType) ? EXECUTORS[taskType] : null;
  return executor ? { executor, code: "OK" } : { executor: null, code: "EXECUTOR_NOT_REGISTERED" };
}
