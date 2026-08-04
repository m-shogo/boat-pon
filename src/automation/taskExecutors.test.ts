import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EXECUTORS, resolveExecutor, runDatasetCanary, runReadonlyAnalysis, runReadonlyAudit, type ExecutorContext } from "./taskExecutors";

// 最小の settlement fixture DB を作る（実 sidecar は触らない）。
function makeFixture(opts: { rows: Array<{ k: string; b: string; s: string; rk?: string; dup?: boolean; superseded?: boolean }> }): string {
  const dir = mkdtempSync(join(tmpdir(), "exec-fixture-"));
  const p = join(dir, "sidecar.sqlite");
  const db = new DatabaseSync(p);
  db.exec(`CREATE TABLE settlement_candidates_v2 (candidate_id TEXT PRIMARY KEY, canonical_race_key TEXT, bet_type TEXT,
    settlement_status TEXT, result_kind TEXT, observation_id TEXT, parse_run_id TEXT, supersedes_candidate_id TEXT)`);
  db.exec(`CREATE TABLE settlement_source_duplicate_resolutions_v2 (duplicate_observation_id TEXT)`);
  db.exec(`CREATE TABLE parse_runs (parse_run_id TEXT PRIMARY KEY, parser_name TEXT)`);
  db.prepare("INSERT INTO parse_runs VALUES ('pr-v1','n1-backfill-archive')").run();
  db.prepare("INSERT INTO parse_runs VALUES ('pr-v2','n2-settlement-reparse')").run();
  let i = 0;
  for (const r of opts.rows) {
    i += 1;
    const id = `c${i}`;
    db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,NULL)")
      .run(id, r.k, r.b, r.s, r.rk ?? "normal", `obs${i}`, "pr-v2");
    if (r.dup) db.prepare("INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?)").run(`obs${i}`);
    if (r.superseded) {
      db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?)")
        .run(`${id}-succ`, r.k, r.b, r.s, "normal", `obs${i}succ`, "pr-v2", id);
    }
  }
  db.close();
  return p;
}

function ctx(sidecarPath: string, over: Partial<ExecutorContext> = {}): ExecutorContext {
  const out = mkdtempSync(join(tmpdir(), "exec-out-"));
  mkdirSync(join(out, "reports/n2"), { recursive: true });
  // corrected truth freeze fixture
  writeFileSync(join(out, "reports/n2/corrected-settlement-truth-freeze.json"), JSON.stringify({
    correctedTruthVersion: "n2-corrected-settlement-truth-v1",
    settlementSnapshotIdentityAfter: "f".repeat(64),
  }));
  return {
    repoRoot: out, runId: "test-run", requestId: "REQ-test", taskId: "TASK-N2-001",
    sidecarPath, historyDir: join(out, "history"), reportsDir: join(out, "reports/n2"),
    dryRun: true, taskStatuses: {}, ...over,
  };
}

test("registry resolves only allowlisted task types", () => {
  assert.deepEqual(Object.keys(EXECUTORS).sort(), ["dataset-canary", "readonly-analysis", "readonly-audit"]);
  assert.equal(resolveExecutor("dataset-canary").code, "OK");
  assert.equal(resolveExecutor("rm -rf /").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("rm -rf /").executor, null);
  // prototype pollution 経由で任意関数を引かない
  assert.equal(resolveExecutor("toString").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("constructor").code, "EXECUTOR_NOT_REGISTERED");
});

test("dataset-canary PASSes and counts eligible/excluded from corrected truth", () => {
  const p = makeFixture({ rows: [
    { k: "2024-06-05:12:R1", b: "trifecta", s: "settled" },
    { k: "2024-06-05:12:R1", b: "exacta", s: "settled" },
    { k: "2024-06-06:12:R2", b: "win", s: "refunded" },      // genuine refund → excluded
    { k: "2024-06-07:12:R3", b: "quinella", s: "settled", dup: true },      // source duplicate → excluded
    { k: "2024-06-08:12:R4", b: "trio", s: "settled", superseded: true },   // superseded → excluded
    { k: "2024-05-31:12:R9", b: "trifecta", s: "settled" },  // cohort 外
  ] });
  const r = runDatasetCanary(ctx(p));
  assert.equal(r.result, "PASS");
  const s = r.summary as any;
  assert.equal(s.candidateCount, 4); // dup/superseded/cohort外 を除いた active（successor 含む）
  assert.equal(s.exclusionReasons.excluded_refunded, 1);
  assert.equal(s.sourceDuplicateExcluded, 1);
  assert.equal(s.supersededExcluded, 1);
  assert.equal(s.pit.result, "PASS");
  assert.equal(s.leakage.result, "PASS");
  assert.ok(s.eligibleRate > 0 && s.eligibleRate <= 1);
});

test("dataset-canary BLOCKs on empty cohort instead of reporting success", () => {
  const p = makeFixture({ rows: [{ k: "2020-01-01:12:R1", b: "trifecta", s: "settled" }] });
  const r = runDatasetCanary(ctx(p));
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("EMPTY_COHORT"));
});

test("dataset-canary BLOCKs when corrected truth freeze is missing", () => {
  const p = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  const c = ctx(p);
  const noFreeze = { ...c, repoRoot: mkdtempSync(join(tmpdir(), "no-freeze-")) };
  const r = runDatasetCanary(noFreeze);
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("CORRECTED_TRUTH_FREEZE_MISSING"));
});

test("readonly-analysis is dependency-gated on TASK-N2-001 PASS", () => {
  const p = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  const blocked = runReadonlyAnalysis(ctx(p, { taskStatuses: { "TASK-N2-001": "READY" } }));
  assert.equal(blocked.result, "BLOCKED");
  assert.ok(blocked.blocks.some((b) => b.startsWith("DEPENDENCY_NOT_SATISFIED")));
  const ok = runReadonlyAnalysis(ctx(p, { taskStatuses: { "TASK-N2-001": "PASS" } }));
  assert.equal(ok.result, "PASS");
  assert.equal((ok.summary as any).forwardResultClaim, false);
});

test("readonly-audit BLOCKs when the source audit report is missing", () => {
  const p = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  const r = runReadonlyAudit(ctx(p));
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("UNEXPECTED_ADDITIONS_AUDIT_MISSING"));
});

test("executors never claim production apply", () => {
  const p = makeFixture({ rows: [{ k: "2024-06-05:12:R1", b: "trifecta", s: "settled" }] });
  const c = ctx(p);
  mkdirSync(join(c.repoRoot, "reports/n2"), { recursive: true });
  writeFileSync(join(c.repoRoot, "reports/n2/unexpected-additions-audit.json"), JSON.stringify({ findings: [] }));
  const r = runReadonlyAudit(c);
  assert.equal(r.result, "PASS");
  assert.equal((r.summary as any).productionApplyExecuted, false);
  assert.equal((r.summary as any).autoCorrectionPossible, false);
  assert.equal((r.summary as any).separateApprovalRequired, true);
});
