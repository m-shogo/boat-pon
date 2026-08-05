import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  EXECUTORS, isExecutorImplemented, resolveExecutor, runDatasetCanary, runDatasetExpand, runHoldoutFreeze,
  runPlannerNext, runReadonlyAnalysis, runReadonlyAudit, type ExecutorContext,
} from "./taskExecutors";

function makeFixture(opts: { rows: Array<{ k: string; b: string; s: string; rk?: string; dup?: boolean; superseded?: boolean }> }): string {
  const dir = mkdtempSync(join(tmpdir(), "exec-fixture-"));
  const path = join(dir, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE settlement_candidates_v2 (candidate_id TEXT PRIMARY KEY, canonical_race_key TEXT, bet_type TEXT,
    settlement_status TEXT, result_kind TEXT, observation_id TEXT, parse_run_id TEXT, supersedes_candidate_id TEXT)`);
  db.exec("CREATE TABLE settlement_source_duplicate_resolutions_v2 (duplicate_observation_id TEXT)");
  db.exec("CREATE TABLE parse_runs (parse_run_id TEXT PRIMARY KEY, parser_name TEXT)");
  db.prepare("INSERT INTO parse_runs VALUES ('pr-v1','n1-backfill-archive')").run();
  db.prepare("INSERT INTO parse_runs VALUES ('pr-v2','n2-settlement-reparse')").run();
  let i = 0;
  for (const row of opts.rows) {
    i += 1;
    const id = `c${i}`;
    db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,NULL)")
      .run(id, row.k, row.b, row.s, row.rk ?? "normal", `obs${i}`, "pr-v2");
    if (row.dup) db.prepare("INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?)").run(`obs${i}`);
    if (row.superseded) {
      db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?)")
        .run(`${id}-succ`, row.k, row.b, row.s, "normal", `obs${i}succ`, "pr-v2", id);
    }
  }
  db.close();
  return path;
}

function ctx(sidecarPath: string, over: Partial<ExecutorContext> = {}): ExecutorContext {
  const root = mkdtempSync(join(tmpdir(), "exec-out-"));
  mkdirSync(join(root, "reports/n2"), { recursive: true });
  writeFileSync(join(root, "reports/n2/corrected-settlement-truth-freeze.json"), JSON.stringify({
    frozenAt: "2026-08-03T14:07:04.991Z",
    correctedTruthVersion: "n2-corrected-settlement-truth-v1",
    settlementSnapshotIdentityAfter: "f".repeat(64),
    heldOut: { count: 2, races: ["2014-03-28:08:R1/win", "2014-03-28:17:R2/win"] },
  }));
  return {
    repoRoot: root, runId: "test-run", requestId: "REQ-test", taskId: "TASK-N2-001",
    sidecarPath, historyDir: join(root, "history"), reportsDir: join(root, "reports/n2"),
    dryRun: true, taskStatuses: {}, ...over,
  };
}

test("registry resolves only allowlisted task types", () => {
  assert.deepEqual(Object.keys(EXECUTORS).sort(), [
    "dataset-canary", "dataset-expand", "dataset-inventory", "feature-coverage-audit", "holdout-freeze",
    "planner-next", "readonly-analysis", "readonly-audit",
  ]);
  assert.equal(resolveExecutor("dataset-canary").code, "OK");
  assert.equal(resolveExecutor("rm -rf /").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("toString").code, "EXECUTOR_NOT_REGISTERED");
});

test("dataset-canary PASSes and counts exclusions", () => {
  const path = makeFixture({ rows: [
    { k: "2024-06-05:12:R1", b: "trifecta", s: "settled" },
    { k: "2024-06-05:12:R1", b: "exacta", s: "settled" },
    { k: "2024-06-06:12:R2", b: "win", s: "refunded" },
    { k: "2024-06-07:12:R3", b: "quinella", s: "settled", dup: true },
    { k: "2024-06-08:12:R4", b: "trio", s: "settled", superseded: true },
    { k: "2024-05-31:12:R9", b: "trifecta", s: "settled" },
  ] });
  const result = runDatasetCanary(ctx(path));
  assert.equal(result.result, "PASS");
  const summary = result.summary as any;
  assert.equal(summary.candidateCount, 4);
  assert.equal(summary.exclusionReasons.excluded_refunded, 1);
  assert.equal(summary.sourceDuplicateExcluded, 1);
  assert.equal(summary.supersededExcluded, 1);
  assert.equal(summary.pit.result, "PASS");
});

test("dataset-canary blocks empty cohort and missing freeze", () => {
  const path = makeFixture({ rows: [{ k: "2020-01-01:12:R1", b: "trifecta", s: "settled" }] });
  assert.equal(runDatasetCanary(ctx(path)).result, "BLOCKED");
  const c = ctx(path);
  const noFreeze = { ...c, repoRoot: mkdtempSync(join(tmpdir(), "no-freeze-")) };
  assert.equal(runDatasetCanary(noFreeze).result, "BLOCKED");
});

test("readonly-analysis is dependency-gated", () => {
  const path = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  assert.equal(runReadonlyAnalysis(ctx(path, { taskStatuses: { "TASK-N2-001": "READY" } })).result, "BLOCKED");
  const ok = runReadonlyAnalysis(ctx(path, { taskStatuses: { "TASK-N2-001": "PASS" } }));
  assert.equal(ok.result, "PASS");
  assert.equal((ok.summary as any).forwardResultClaim, false);
});

test("readonly-audit blocks without source report", () => {
  const path = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  assert.equal(runReadonlyAudit(ctx(path)).result, "BLOCKED");
});

test("holdout-freeze is deterministic and dependency-gated", () => {
  const path = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  assert.equal(runHoldoutFreeze(ctx(path, { taskStatuses: { "TASK-N2-004": "READY" } })).result, "BLOCKED");
  const a = runHoldoutFreeze(ctx(path, { taskStatuses: { "TASK-N2-004": "PASS" } }));
  const b = runHoldoutFreeze(ctx(path, { taskStatuses: { "TASK-N2-004": "PASS" } }));
  assert.equal(a.result, "PASS");
  assert.equal(a.outputDigest, b.outputDigest);
  assert.deepEqual((a.summary as any).untouchedHoldoutRaces, ["2014-03-28:08:R1", "2014-03-28:17:R2"]);
});

test("planner does not rewrite unchanged ENGINEERING_REQUIRED candidates", () => {
  const path = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  const c = ctx(path, {
    dryRun: false,
    mergedTasks: [
      { taskId: "TASK-B", status: "BLOCKED_EXECUTOR_PENDING", taskType: "baseline-market", title: "m", objective: "o", safetyLevel: "L0" },
    ],
  });
  const first = runPlannerNext(c);
  assert.equal(first.result, "PASS");
  assert.equal(first.outputs.length, 1);
  const second = runPlannerNext({ ...c, runId: "test-run-2", requestId: "REQ-test-2" });
  assert.equal(second.result, "PASS");
  assert.equal((second.summary as any).status, "NO_CHANGE_ENGINEERING_REQUIRED");
  assert.deepEqual(second.outputs, []);
});

test("dataset-expand separates inventory from holdout-free research cohort", () => {
  const path = makeFixture({ rows: [
    { k: "2014-03-28:08:R1", b: "win", s: "settled" },
    { k: "2020-06-05:12:R1", b: "trifecta", s: "settled" },
    { k: "2021-06-05:12:R2", b: "exacta", s: "settled" },
    { k: "2022-06-05:12:R3", b: "win", s: "refunded" },
  ] });
  const c = ctx(path, { taskId: "TASK-N2-010", taskStatuses: { "TASK-N2-004": "PASS" } }); // ctx() は dryRun:true
  const result = runDatasetExpand(c);
  // Review A: dry-run は PASS ではなく DRY_RUN_OK。separation の summary は算出されるが write しない。
  assert.equal(result.result, "DRY_RUN_OK");
  const summary = result.summary as any;
  assert.equal(summary.datasetManifestVersion, "n2-dataset-manifest-v2");
  assert.equal(summary.inventoryTotals.candidates, 4);
  assert.equal(summary.researchEligibleTotals.candidates, 3);
  assert.equal(summary.holdoutCandidatesPresent, 1);
  assert.equal(summary.holdoutExcludedFromResearchCohort, true);
  assert.equal("holdoutExcluded" in summary, false);
  assert.equal(JSON.stringify(summary).includes("2014-03-28:08:R1"), false);
  assert.equal(summary.pitEvidence.status, "NOT_APPLICABLE");
  assert.equal(existsSync(join(c.repoRoot, "reports/n2/n2-dataset-manifest.json")), false);
});

test("dataset-expand writes, verifies and safely replays Experiment/Discovery", () => {
  const path = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  const c = ctx(path, { dryRun: false, taskId: "TASK-N2-010", taskStatuses: { "TASK-N2-004": "PASS" } });
  const first = runDatasetExpand(c);
  assert.equal(first.result, "PASS");
  assert.ok(first.outputs.some((o) => o.includes("/experiments/")));
  assert.ok(first.outputs.some((o) => o.includes("/discoveries/")));
  const reportPath = join(c.repoRoot, "reports/n2/n2-dataset-manifest.json");
  assert.equal(existsSync(reportPath), true);
  const reportText = readFileSync(reportPath, "utf8");
  assert.equal(reportText.includes("2014-03-28:08:R1"), false);
  assert.equal(JSON.parse(reportText).outputDigest, first.outputDigest);

  const replay = runDatasetExpand({ ...c, runId: "test-run-replay", requestId: "REQ-replay" });
  assert.equal(replay.result, "PASS");
  assert.equal(replay.outputDigest, first.outputDigest);
});

test("isExecutorImplemented distinguishes implemented from pending", () => {
  assert.equal(isExecutorImplemented("dataset-inventory"), true);
  assert.equal(isExecutorImplemented("dataset-expand"), true);
  assert.equal(isExecutorImplemented("baseline-market"), false);
});

test("executors never claim production apply", () => {
  const path = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  const c = ctx(path);
  writeFileSync(join(c.repoRoot, "reports/n2/unexpected-additions-audit.json"), JSON.stringify({ findings: [] }));
  const result = runReadonlyAudit(c);
  assert.equal(result.result, "PASS");
  assert.equal((result.summary as any).productionApplyExecuted, false);
  assert.equal((result.summary as any).autoCorrectionPossible, false);
  assert.equal((result.summary as any).separateApprovalRequired, true);
});
