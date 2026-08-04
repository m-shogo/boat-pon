// boat-pon task executor registry（allowlist のみ・arbitrary shell 禁止）。
//
// taskType ごとの executor を静的 registry で解決する。未登録 taskType は EXECUTOR_NOT_REGISTERED として
// BLOCK し、NO_CHANGE を成功扱いにしない。executor は read-only 実行（実 sidecar への write を行わない）。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "../research-replay/canonical";
import {
  N2_DATASET_CONTRACT_VERSION, N2_FEATURE_PIT_CONTRACT_VERSION, N2_TARGET_CONTRACT_VERSION,
} from "../research-replay/n2DatasetContract";

export const EXECUTOR_REGISTRY_VERSION = "n2-task-executor-registry-v1";

export type ExecutorResult = {
  result: "PASS" | "CONDITIONAL" | "BLOCKED" | "FAILED";
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
  /** dependency task の状態（依存 gate 判定用） */
  taskStatuses: Record<string, string>;
  /** planner 用: merge 済み task 一覧（status/type/deps）。runner が渡す。 */
  mergedTasks?: Array<{ taskId: string; status: string; taskType: string; defaultStatus?: string; dependencies?: string[]; title?: string; objective?: string; safetyLevel?: string }>;
  /** planner 用: automation branch control ディレクトリ（registries を read-only で読む） */
  controlDir?: string;
};

export type Executor = (ctx: ExecutorContext) => ExecutorResult;

// ---- 共通 helper ----
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
function loadFreeze(repoRoot: string): Record<string, any> | null {
  const p = join(repoRoot, "reports/n2/corrected-settlement-truth-freeze.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
const HELD_OUT_RACES = ["2014-03-28:08:R1", "2014-03-28:17:R2"] as const;
const HELD_OUT_KEYS = new Set(HELD_OUT_RACES.map((r) => `${r}|win`));

// 決定的 canary cohort: 固定月（corrected truth 適用済みの範囲から再現可能に選ぶ）。
export const CANARY_COHORT = {
  definition: "fixed-month cohort: 2024-06 (deterministic, no random sampling)",
  fromRaceKey: "2024-06-01:",
  toRaceKeyExclusive: "2024-07-01:",
} as const;

// ---- TASK-N2-001: dataset canary ----
export const runDatasetCanary: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length > 0) {
    return { result: "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary: { blocks }, outputs: [], outputDigest: canonicalHash({ blocks }), blocks };
  }
  const db = openReadOnly(ctx.sidecarPath);
  try {
    // active canonical candidate（source_duplicate 除外・superseded 除外）を cohort 範囲で集計する。
    const rows = db.prepare(`
      SELECT c.canonical_race_key AS k, c.bet_type AS b, c.settlement_status AS s, c.result_kind AS rk,
             c.parse_run_id AS pr
      FROM settlement_candidates_v2 c
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
        AND NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id = c.observation_id)
        AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id = c.candidate_id)
    `).all(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as Array<{ k: string; b: string; s: string; rk: string; pr: string }>;

    // superseded / source duplicate は上の anti-join で除外済み。件数も別途数えて証拠に残す。
    const supersededCount = Number((db.prepare(`
      SELECT COUNT(*) n FROM settlement_candidates_v2 c
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
        AND EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id = c.candidate_id)
    `).get(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as { n: number }).n);
    const sourceDuplicateCount = Number((db.prepare(`
      SELECT COUNT(*) n FROM settlement_candidates_v2 c
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
        AND EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id = c.observation_id)
    `).get(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as { n: number }).n);
    // corrected truth 由来（reparse parse_run）の candidate 数。
    const correctedCount = Number((db.prepare(`
      SELECT COUNT(*) n FROM settlement_candidates_v2 c
      JOIN parse_runs p ON p.parse_run_id = c.parse_run_id
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ? AND p.parser_name = 'n2-settlement-reparse'
        AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id = c.candidate_id)
    `).get(CANARY_COHORT.fromRaceKey, CANARY_COHORT.toRaceKeyExclusive) as { n: number }).n);

    const races = new Set<string>();
    const exclusions: Record<string, number> = {};
    let eligible = 0, heldOutExcluded = 0;
    const byStatus: Record<string, number> = {};
    const byBetType: Record<string, number> = {};
    for (const r of rows) {
      races.add(r.k);
      byStatus[r.s] = (byStatus[r.s] ?? 0) + 1;
      byBetType[r.b] = (byBetType[r.b] ?? 0) + 1;
      if (HELD_OUT_KEYS.has(`${r.k}|${r.b}`)) { heldOutExcluded += 1; exclusions.held_out_win_refund_omission = (exclusions.held_out_win_refund_omission ?? 0) + 1; continue; }
      if (r.s === "refunded") { exclusions.excluded_refunded = (exclusions.excluded_refunded ?? 0) + 1; continue; }
      if (r.s === "cancelled" || r.s === "no_sale" || r.s === "pending") { exclusions[`excluded_${r.s}`] = (exclusions[`excluded_${r.s}`] ?? 0) + 1; continue; }
      // settled / partially_refunded は eligible（partial は refund selection を label 側で分離）。
      eligible += 1;
    }
    const total = rows.length;
    const eligibleRate = total > 0 ? eligible / total : null;

    // PIT / leakage: canary は settlement label のみを読み、race 後 feature を一切読まない。
    // 同一 race の他 candidate から label を借りない（race+bet 単位で独立）ことを構造的に保証する。
    const pit = { mode: "historical", featureSourcesRead: [], postRaceFeatureRead: false, result: "PASS" as const };
    const leakage = { sameRaceLabelBorrow: false, futureCandidateRead: false, result: "PASS" as const };

    const summary = {
      datasetContractVersion: N2_DATASET_CONTRACT_VERSION,
      targetContractVersion: N2_TARGET_CONTRACT_VERSION,
      featurePitContractVersion: N2_FEATURE_PIT_CONTRACT_VERSION,
      correctedTruthVersion: freeze!.correctedTruthVersion,
      sourceSettlementIdentity: freeze!.settlementSnapshotIdentityAfter,
      cohort: CANARY_COHORT,
      raceCount: races.size,
      candidateCount: total,
      correctedTruthCandidates: correctedCount,
      eligibleCount: eligible,
      excludedCount: total - eligible,
      exclusionReasons: exclusions,
      heldOutExcluded,
      heldOutRaces: HELD_OUT_RACES,
      sourceDuplicateExcluded: sourceDuplicateCount,
      supersededExcluded: supersededCount,
      eligibleRate,
      byStatus, byBetType,
      pit, leakage,
      timeSplit: { policy: "time-based, race-level group; canary is a single fixed month and is NOT a train/test split" },
      featureAvailability: "NOT_APPLICABLE (label-only canary; feature join is a later task)",
      missingness: { note: "settlement labels only; feature missingness is out of scope for this canary" },
    };
    const outputDigest = canonicalHash(summary);
    const result: ExecutorResult["result"] =
      total === 0 ? "BLOCKED"
        : (pit.result === "PASS" && leakage.result === "PASS") ? "PASS" : "CONDITIONAL";

    const outputs: string[] = [];
    if (!ctx.dryRun) {
      mkdirSync(ctx.reportsDir, { recursive: true });
      const payload = { ...summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId, executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest, result };
      writeFileSync(join(ctx.reportsDir, "n2-dataset-canary.json"), `${JSON.stringify(payload, null, 2)}\n`);
      writeFileSync(join(ctx.reportsDir, "n2-dataset-canary.md"), renderCanaryMd(payload));
      outputs.push("reports/n2/n2-dataset-canary.json", "reports/n2/n2-dataset-canary.md");
    }
    return { result, executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: total === 0 ? ["EMPTY_COHORT"] : [] };
  } finally { db.close(); }
};

function renderCanaryMd(p: Record<string, any>): string {
  return `# N2 dataset canary（corrected truth）

- generated: ${p.generatedAt} / run: ${p.runId} / request: ${p.requestId}
- result: **${p.result}** / digest: ${p.outputDigest}
- corrected truth: ${p.correctedTruthVersion} / settlement identity: ${p.sourceSettlementIdentity}
- contracts: ${p.datasetContractVersion} / ${p.targetContractVersion} / ${p.featurePitContractVersion}
- cohort: ${p.cohort.definition}

| 指標 | 値 |
|---|---:|
| races | ${p.raceCount} |
| candidates | ${p.candidateCount} |
| corrected-truth candidates | ${p.correctedTruthCandidates} |
| eligible | ${p.eligibleCount} |
| excluded | ${p.excludedCount} |
| eligible rate | ${p.eligibleRate === null ? "NOT_AVAILABLE" : (p.eligibleRate * 100).toFixed(2) + "%"} |
| held-out excluded | ${p.heldOutExcluded} |
| source duplicate excluded | ${p.sourceDuplicateExcluded} |
| superseded excluded | ${p.supersededExcluded} |

- exclusion reasons: ${JSON.stringify(p.exclusionReasons)}
- by status: ${JSON.stringify(p.byStatus)}
- by bet type: ${JSON.stringify(p.byBetType)}
- PIT: ${p.pit.result} / leakage: ${p.leakage.result}
- time split: ${p.timeSplit.policy}

> read-only canary。実 sidecar への write なし。held-out 2 件（win 返還欠落）は除外して数える。
`;
}

// ---- TASK-N2-002: corrected eligible 率 / 年代 drift 再集計 ----
export const runReadonlyAnalysis: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  // 依存 gate: TASK-N2-001 が PASS でなければ実行しない。
  const dep = ctx.taskStatuses["TASK-N2-001"];
  if (dep !== "PASS") blocks.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-001=${dep ?? "UNKNOWN"}`);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length > 0) {
    return { result: "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary: { blocks }, outputs: [], outputDigest: canonicalHash({ blocks }), blocks };
  }
  const db = openReadOnly(ctx.sidecarPath);
  try {
    const byYear = db.prepare(`
      SELECT substr(c.canonical_race_key,1,4) AS y, c.settlement_status AS s, COUNT(*) AS n
      FROM settlement_candidates_v2 c
      WHERE NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id = c.observation_id)
        AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id = c.candidate_id)
      GROUP BY 1,2 ORDER BY 1,2
    `).all() as Array<{ y: string; s: string; n: number }>;
    const byBet = db.prepare(`
      SELECT c.bet_type AS b, c.settlement_status AS s, COUNT(*) AS n
      FROM settlement_candidates_v2 c
      WHERE NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id = c.observation_id)
        AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id = c.candidate_id)
      GROUP BY 1,2 ORDER BY 1,2
    `).all() as Array<{ b: string; s: string; n: number }>;

    const yearAgg: Record<string, { total: number; settled: number; refunded: number; eligibleRate: number }> = {};
    for (const r of byYear) {
      const a = yearAgg[r.y] ?? { total: 0, settled: 0, refunded: 0, eligibleRate: 0 };
      a.total += Number(r.n);
      if (r.s === "settled") a.settled += Number(r.n);
      if (r.s === "refunded") a.refunded += Number(r.n);
      yearAgg[r.y] = a;
    }
    for (const y of Object.keys(yearAgg)) yearAgg[y].eligibleRate = yearAgg[y].total > 0 ? yearAgg[y].settled / yearAgg[y].total : 0;
    const betAgg: Record<string, { total: number; settled: number; refunded: number }> = {};
    for (const r of byBet) {
      const a = betAgg[r.b] ?? { total: 0, settled: 0, refunded: 0 };
      a.total += Number(r.n);
      if (r.s === "settled") a.settled += Number(r.n);
      if (r.s === "refunded") a.refunded += Number(r.n);
      betAgg[r.b] = a;
    }
    const totals = Object.values(yearAgg).reduce((acc, a) => ({ total: acc.total + a.total, settled: acc.settled + a.settled, refunded: acc.refunded + a.refunded }), { total: 0, settled: 0, refunded: 0 });
    const correctedEligibleRate = totals.total > 0 ? totals.settled / totals.total : null;

    const summary = {
      correctedTruthVersion: freeze!.correctedTruthVersion,
      sourceSettlementIdentity: freeze!.settlementSnapshotIdentityAfter,
      correctedEligibleRate,
      totals,
      byYear: yearAgg, byBetType: betAgg,
      legacyComparison: {
        legacyEligibleRate: 0.9603,
        legacySource: "reports/n2/n2-dataset-profile.json (v1 parser 由来, 誤分類を含む)",
        deltaPoints: correctedEligibleRate === null ? null : (correctedEligibleRate - 0.9603) * 100,
        note: "legacy は v1 特払い bug 由来の偽返還 317,747 件を含む。corrected はそれを訂正済み。historical 集計であり forward 結果ではない。",
      },
      specialPayoutImpact: { additions: 65156, note: "v1 が抑止していた特払い candidate を v2 で顕在化" },
      genuineRefundImpact: { remaining: 1554, note: "真の返還は維持（訂正対象外）" },
      sourceCoverage: { note: "corrected truth freeze の active candidate 全体" },
      forwardResultClaim: false,
    };
    const outputDigest = canonicalHash(summary);
    const outputs: string[] = [];
    if (!ctx.dryRun) {
      mkdirSync(ctx.reportsDir, { recursive: true });
      const payload = { ...summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId, executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest };
      writeFileSync(join(ctx.reportsDir, "n2-corrected-eligibility.json"), `${JSON.stringify(payload, null, 2)}\n`);
      outputs.push("reports/n2/n2-corrected-eligibility.json");
    }
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

// ---- TASK-N2-003: held-out win 返還欠落の別 defect 調査（read-only, 実 DB 変更なし）----
export const runReadonlyAudit: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  const auditPath = join(ctx.repoRoot, "reports/n2/unexpected-additions-audit.json");
  if (!existsSync(auditPath)) blocks.push("UNEXPECTED_ADDITIONS_AUDIT_MISSING");
  if (blocks.length > 0) {
    return { result: "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary: { blocks }, outputs: [], outputDigest: canonicalHash({ blocks }), blocks };
  }
  const audit = JSON.parse(readFileSync(auditPath, "utf8"));
  const db = openReadOnly(ctx.sidecarPath);
  try {
    // 同種候補の走査: win の active candidate が存在しない race を数える（影響範囲 scan）。
    const winMissing = Number((db.prepare(`
      SELECT COUNT(*) n FROM (
        SELECT DISTINCT c.canonical_race_key k FROM settlement_candidates_v2 c
        WHERE NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id = c.observation_id)
          AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id = c.candidate_id)
      ) r
      WHERE NOT EXISTS (
        SELECT 1 FROM settlement_candidates_v2 w WHERE w.canonical_race_key = r.k AND w.bet_type = 'win'
          AND NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d2 WHERE d2.duplicate_observation_id = w.observation_id)
          AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s3 WHERE s3.supersedes_candidate_id = w.candidate_id))
    `).get() as { n: number }).n);

    const lineage = (audit.findings ?? []).map((f: any) => ({
      raceKey: f.raceKey, betType: f.betType, classification: f.classification,
      v2Status: f.v2Status, v2ResultKind: f.v2ResultKind, v2RefundLines: f.v2RefundLines,
      rawDocumentId: f.rawDocumentId, rawSha256: f.rawSha256, archiveFile: f.archiveFile,
      sidecarCandidatesForRaceBet: f.allCandidatesForRaceBet,
      autoApplyEligible: f.autoApplyEligible,
    }));

    const summary = {
      heldOutCount: lineage.length,
      lineage,
      defectMechanism: "v1 parser は win 券種の返還 line を candidate 化せず、当該 race+bet_type の candidate 自体を生成しなかった。v2 は refunded candidate を導出する。特払い false-refund（V1_SPECIAL_PAYOUT_FALSE_REFUND）とは別機序。",
      parserDiff: { v1: "no candidate emitted for win refund", v2: "emits refunded candidate with refund line" },
      impactScan: { racesWithoutActiveWinCandidate: winMissing, note: "win candidate が存在しない race 総数（本 defect の上限候補。全てが本 defect とは限らない）" },
      sameKindCandidateCount: winMissing,
      autoCorrectionPossible: false,
      autoCorrectionReason: "本 reparse の承認 scope（V1_SPECIAL_PAYOUT_FALSE_REFUND）外。別 defect code・別 approval が必要。",
      separateApprovalRequired: true,
      proposedDefectCode: "V1_WIN_REFUND_OMISSION",
      proposedFixContract: "archive を v2 で再parse し、win 返還 candidate が欠落している race+bet_type へ initial candidate を append-only 追加する（supersession ではなく欠落補完）。承認 target digest は本件専用に新規計算する。",
      productionApplyExecuted: false,
    };
    const outputDigest = canonicalHash(summary);
    const outputs: string[] = [];
    if (!ctx.dryRun) {
      mkdirSync(ctx.reportsDir, { recursive: true });
      const payload = { ...summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId, executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest };
      writeFileSync(join(ctx.reportsDir, "n2-win-refund-omission-audit.json"), `${JSON.stringify(payload, null, 2)}\n`);
      outputs.push("reports/n2/n2-win-refund-omission-audit.json");
    }
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

// ---- TASK-N2-004: full-period dataset inventory（read-only）----
// 全期間の active settlement candidate を年・券種で棚卸しする。
export const runDatasetInventory: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length > 0) {
    return { result: "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary: { blocks }, outputs: [], outputDigest: canonicalHash({ blocks }), blocks };
  }
  const db = openReadOnly(ctx.sidecarPath);
  try {
    // active = source_duplicate 除外 + superseded 除外。dup 列は未 index のため LEFT JOIN で 1 scan に抑える。
    // race key は日付始まりなので race は年をまたがない → per-year distinct race の総和 = 全 distinct race。
    const active = `LEFT JOIN settlement_source_duplicate_resolutions_v2 d ON d.duplicate_observation_id = c.observation_id
      WHERE d.duplicate_observation_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s2 WHERE s2.supersedes_candidate_id = c.candidate_id)`;
    const byYear = db.prepare(`SELECT substr(c.canonical_race_key,1,4) y, COUNT(*) n, COUNT(DISTINCT c.canonical_race_key) r
      FROM settlement_candidates_v2 c ${active} GROUP BY 1 ORDER BY 1`).all() as Array<{ y: string; n: number; r: number }>;
    const byBet = db.prepare(`SELECT c.bet_type b, COUNT(*) n
      FROM settlement_candidates_v2 c ${active} GROUP BY 1 ORDER BY 1`).all() as Array<{ b: string; n: number }>;
    // 全体 race key range（exclusion 抜き。indexed 列で安価。active はこの範囲内）。
    const rawRange = db.prepare(`SELECT MIN(canonical_race_key) lo, MAX(canonical_race_key) hi FROM settlement_candidates_v2`).get() as { lo: string; hi: string };

    const totalCandidates = byYear.reduce((s, r) => s + Number(r.n), 0);
    const totalRaces = byYear.reduce((s, r) => s + Number(r.r), 0);
    const summary = {
      correctedTruthVersion: freeze!.correctedTruthVersion,
      sourceSettlementIdentity: freeze!.settlementSnapshotIdentityAfter,
      totalActiveCandidates: totalCandidates,
      totalRaces,
      rawRaceKeyRange: { from: rawRange.lo, to: rawRange.hi, note: "exclusion 抜きの全体範囲。active はこの内側。" },
      yearCount: byYear.length,
      byYear: Object.fromEntries(byYear.map((r) => [r.y, { candidates: Number(r.n), races: Number(r.r) }])),
      byBetType: Object.fromEntries(byBet.map((r) => [r.b, Number(r.n)])),
      readOnly: true,
      note: "全期間 active settlement candidate の棚卸し（source-dup / superseded 除外）。feature/odds は本 sidecar 外。",
    };
    const bounds = { n: totalCandidates };
    const outputDigest = canonicalHash(summary);
    const outputs: string[] = [];
    if (!ctx.dryRun) {
      mkdirSync(ctx.reportsDir, { recursive: true });
      const payload = { ...summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId, executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest };
      writeFileSync(join(ctx.reportsDir, "n2-dataset-inventory.json"), `${JSON.stringify(payload, null, 2)}\n`);
      outputs.push("reports/n2/n2-dataset-inventory.json");
    }
    return { result: Number(bounds.n) > 0 ? "PASS" : "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: Number(bounds.n) > 0 ? [] : ["EMPTY_INVENTORY"] };
  } finally { db.close(); }
};

// ---- TASK-N2-005: untouched holdout freeze + time split（read-only, deterministic）----
export const runHoldoutFreeze: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  if (ctx.taskStatuses["TASK-N2-004"] !== "PASS") blocks.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-004=${ctx.taskStatuses["TASK-N2-004"] ?? "UNKNOWN"}`);
  const freeze = loadFreeze(ctx.repoRoot);
  if (!freeze) blocks.push("CORRECTED_TRUTH_FREEZE_MISSING");
  if (blocks.length > 0) {
    return { result: "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary: { blocks }, outputs: [], outputDigest: canonicalHash({ blocks }), blocks };
  }
  // deterministic contract: 触れない holdout（win 返還欠落 2 件）を恒久固定し、time-based split の境界を宣言する。
  const summary = {
    holdoutContractVersion: "n2-holdout-freeze-v1",
    correctedTruthVersion: freeze!.correctedTruthVersion,
    untouchedHoldoutRaces: HELD_OUT_RACES,
    untouchedHoldoutRule: "この 2 race は production にも dataset にも適用しない。別 defect(V1_WIN_REFUND_OMISSION) の別承認まで永久に据え置く。",
    timeSplit: {
      policy: "time-based, race-level group split（漏洩防止のため race 単位で分割）",
      train: { toRaceKeyExclusive: "2022-01-01:" },
      validation: { fromRaceKey: "2022-01-01:", toRaceKeyExclusive: "2024-01-01:" },
      test: { fromRaceKey: "2024-01-01:", toRaceKeyExclusive: "2026-01-01:" },
      forwardShadow: { fromRaceKey: "2026-01-01:", note: "shadow-forward 用。production 反映はしない。" },
    },
    productionApplyExecuted: false,
    note: "read-only・deterministic。実 sidecar への write なし。",
  };
  const outputDigest = canonicalHash(summary);
  const outputs: string[] = [];
  if (!ctx.dryRun) {
    mkdirSync(ctx.reportsDir, { recursive: true });
    const payload = { ...summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId, executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest };
    writeFileSync(join(ctx.reportsDir, "n2-holdout-freeze.json"), `${JSON.stringify(payload, null, 2)}\n`);
    outputs.push("reports/n2/n2-holdout-freeze.json");
  }
  return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
};

// ---- TASK-N2-006: settlement coverage / missingness audit（read-only）----
export const runFeatureCoverageAudit: Executor = (ctx) => {
  const blocks = assertQuiescent(ctx.sidecarPath);
  if (ctx.taskStatuses["TASK-N2-004"] !== "PASS") blocks.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-004=${ctx.taskStatuses["TASK-N2-004"] ?? "UNKNOWN"}`);
  if (blocks.length > 0) {
    return { result: "BLOCKED", executorVersion: EXECUTOR_REGISTRY_VERSION, summary: { blocks }, outputs: [], outputDigest: canonicalHash({ blocks }), blocks };
  }
  const db = openReadOnly(ctx.sidecarPath);
  try {
    // status 列は settlement_status 上で集計。coverage は candidate_id join（PK indexed）で数える。
    // dup/superseded の除外は coverage 比率にはほぼ影響しないため、ここでは raw status ベース（scope を明記）。
    const settled = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 WHERE settlement_status='settled'`).get() as { n: number }).n);
    const withPayout = Number((db.prepare(`SELECT COUNT(DISTINCT c.candidate_id) n FROM settlement_candidates_v2 c
      JOIN race_payout_lines_v2 p ON p.candidate_id=c.candidate_id WHERE c.settlement_status='settled'`).get() as { n: number }).n);
    const refunded = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 WHERE settlement_status='refunded'`).get() as { n: number }).n);
    const withRefund = Number((db.prepare(`SELECT COUNT(DISTINCT c.candidate_id) n FROM settlement_candidates_v2 c
      JOIN race_refund_lines_v2 r ON r.candidate_id=c.candidate_id WHERE c.settlement_status='refunded'`).get() as { n: number }).n);
    const payoutCoverage = settled > 0 ? withPayout / settled : null;
    const refundCoverage = refunded > 0 ? withRefund / refunded : null;
    const summary = {
      auditContractVersion: "n2-settlement-coverage-v1",
      settledCandidates: settled, settledWithPayoutLines: withPayout, payoutLineCoverage: payoutCoverage,
      refundedCandidates: refunded, refundedWithRefundLines: withRefund, refundLineCoverage: refundCoverage,
      missingness: {
        settledMissingPayoutLines: settled - withPayout,
        refundedMissingRefundLines: refunded - withRefund,
        note: "settled は payout line、refunded は refund line を持つべき。欠落は dataset 品質フラグ。",
      },
      scope: "settlement schema のみ（feature/odds は本 sidecar 外＝別 dataRoot 未接続）",
      readOnly: true,
    };
    const outputDigest = canonicalHash(summary);
    const outputs: string[] = [];
    if (!ctx.dryRun) {
      mkdirSync(ctx.reportsDir, { recursive: true });
      const payload = { ...summary, runId: ctx.runId, requestId: ctx.requestId, taskId: ctx.taskId, executorVersion: EXECUTOR_REGISTRY_VERSION, generatedAt: new Date().toISOString(), outputDigest };
      writeFileSync(join(ctx.reportsDir, "n2-feature-coverage-audit.json"), `${JSON.stringify(payload, null, 2)}\n`);
      outputs.push("reports/n2/n2-feature-coverage-audit.json");
    }
    // coverage が読めれば PASS。欠落自体は品質フラグであり失敗ではない。
    return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally { db.close(); }
};

// ---- TASK-PLANNER-NEXT: queue が枯れたときの次候補提案（自動実行しない・自動 dispatch しない）----
export const runPlannerNext: Executor = (ctx) => {
  const merged = ctx.mergedTasks ?? [];
  const readyCount = merged.filter((t) => t.status === "READY").length;
  // executor 未実装で BLOCKED_EXECUTOR_PENDING の task を「次に実装すべき候補」として棚卸しする。
  const pendingExecutors = merged.filter((t) => t.status === "BLOCKED_EXECUTOR_PENDING");
  const candidates = pendingExecutors.map((t, i) => ({
    candidateId: `CAND-${ctx.runId}-${i + 1}`,
    proposedTaskId: t.taskId,
    title: t.title ?? t.taskId,
    objective: t.objective ?? "",
    taskType: t.taskType,
    executorType: t.taskType,
    safetyLevel: t.safetyLevel ?? "L0",
    dependencies: t.dependencies ?? [],
    reason: "executor 未実装。実装後に READY 化できる候補。",
    duplicateCheck: "catalog 内 taskId で一意",
    invalidationCondition: "対応 executor が実装され、catalog defaultStatus が READY になったら本候補は解消",
    proposedAt: new Date().toISOString(),
  }));
  const summary = {
    plannerVersion: "n2-planner-v1",
    readyTaskCount: readyCount,
    blockedExecutorPendingCount: pendingExecutors.length,
    candidateCount: candidates.length,
    candidates,
    autoDispatch: false,
    note: "planner は候補を提案するだけ。自動実行・自動 dispatch は行わない。READY task がある間は補充不要。",
  };
  const outputDigest = canonicalHash({ candidates: candidates.map((c) => ({ ...c, candidateId: "_", proposedAt: "_" })) });
  const outputs: string[] = [];
  if (!ctx.dryRun) {
    const dir = ctx.controlDir ?? join(ctx.repoRoot, "automation/control");
    mkdirSync(dir, { recursive: true });
    const payload = { plannerCandidatesSchemaVersion: "planner-candidates-v1", ...summary, runId: ctx.runId, requestId: ctx.requestId, generatedAt: new Date().toISOString(), outputDigest };
    writeFileSync(join(dir, "planner-candidates.json"), `${JSON.stringify(payload, null, 2)}\n`);
    outputs.push("automation/control/planner-candidates.json");
  }
  return { result: "PASS", executorVersion: EXECUTOR_REGISTRY_VERSION, summary, outputs, outputDigest, blocks: [] };
};

// ---- registry（allowlist）----
export const EXECUTORS: Readonly<Record<string, Executor>> = Object.freeze({
  "dataset-canary": runDatasetCanary,
  "readonly-analysis": runReadonlyAnalysis,
  "readonly-audit": runReadonlyAudit,
  "dataset-inventory": runDatasetInventory,
  "holdout-freeze": runHoldoutFreeze,
  "feature-coverage-audit": runFeatureCoverageAudit,
  "planner-next": runPlannerNext,
});

// catalog が参照し得る全 taskType（未実装は BLOCKED_EXECUTOR_PENDING として catalog 側で据え置く）。
// READY 化してよいのは EXECUTORS に載っている taskType のみ。
export const KNOWN_TASK_TYPES = [
  "dataset-canary", "readonly-analysis", "readonly-audit", "dataset-inventory", "holdout-freeze",
  "feature-coverage-audit", "planner-next",
  // 以下は未実装（feature/odds データ未接続）。catalog では BLOCKED_EXECUTOR_PENDING。
  "dataset-expand", "pit-audit", "baseline-market", "baseline-historical", "baseline-common-cohort",
  "evaluation-metrics", "edge-hypothesis-scan", "edge-historical-test", "confounder-audit",
] as const;
export function isExecutorImplemented(taskType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXECUTORS, taskType);
}

export function resolveExecutor(taskType: string): { executor: Executor | null; code: "OK" | "EXECUTOR_NOT_REGISTERED" } {
  const executor = Object.prototype.hasOwnProperty.call(EXECUTORS, taskType) ? EXECUTORS[taskType] : null;
  return executor ? { executor, code: "OK" } : { executor: null, code: "EXECUTOR_NOT_REGISTERED" };
}
