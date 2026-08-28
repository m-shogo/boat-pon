import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash } from "../research-replay/canonical";
import { readCurrentlyValidSourceDuplicateObservationIds } from "../research-replay/n1SourceDuplicateResolutionValidation";
import { atomicWriteJson, verifyJsonReadback } from "../research/governance/executorSdk";
import { preflightN2AllActiveSettlementLineage } from "./n2DatasetCanarySettlementGuard";
import type { Executor, ExecutorResult } from "./taskExecutorsCore";

const EXECUTOR_VERSION = "n2-feature-coverage-runtime-v3";

function blocked(blocks: string[]): ExecutorResult {
  return {
    result: "BLOCKED",
    executorVersion: EXECUTOR_VERSION,
    summary: { blocks },
    outputs: [],
    outputDigest: canonicalHash({ blocks }),
    blocks,
  };
}

export const runN2ActiveFeatureCoverageAudit: Executor = (ctx) => {
  const blocks: string[] = [];
  if (!existsSync(ctx.sidecarPath)) blocks.push("SIDECAR_NOT_FOUND");
  const wal = `${ctx.sidecarPath}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) blocks.push("ACTIVE_WAL");
  if (ctx.taskStatuses["TASK-N2-004"] !== "PASS") {
    blocks.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-004=${ctx.taskStatuses["TASK-N2-004"] ?? "UNKNOWN"}`);
  }
  if (blocks.length) return blocked(blocks);

  const db = new DatabaseSync(`${pathToFileURL(ctx.sidecarPath).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  try {
    try {
      readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      return blocked(["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"]);
    }
    const settlementPreflight = preflightN2AllActiveSettlementLineage(ctx.sidecarPath);
    if (!settlementPreflight.ok) return blocked(settlementPreflight.blocks);

    const active = `
      NOT EXISTS (
        SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d
        WHERE d.duplicate_observation_id=c.observation_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM settlement_candidates_v2 newer
        WHERE newer.supersedes_candidate_id=c.candidate_id
      )`;
    const settled = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 c WHERE c.settlement_status='settled' AND ${active}`).get() as { n: number }).n);
    const refunded = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 c WHERE c.settlement_status='refunded' AND ${active}`).get() as { n: number }).n);
    const withPayout = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 c WHERE c.settlement_status='settled' AND ${active} AND EXISTS (SELECT 1 FROM race_payout_lines_v2 p WHERE p.candidate_id=c.candidate_id AND p.bet_type=c.bet_type)`).get() as { n: number }).n);
    const withRefund = Number((db.prepare(`SELECT COUNT(*) n FROM settlement_candidates_v2 c WHERE c.settlement_status='refunded' AND ${active} AND EXISTS (SELECT 1 FROM race_refund_lines_v2 r WHERE r.candidate_id=c.candidate_id AND r.bet_type=c.bet_type)`).get() as { n: number }).n);
    const summary = {
      auditContractVersion: "n2-settlement-coverage-v3-active-line-bet-lineage",
      settledCandidates: settled,
      settledWithPayoutLines: withPayout,
      payoutLineCoverage: settled ? withPayout / settled : null,
      refundedCandidates: refunded,
      refundedWithRefundLines: withRefund,
      refundLineCoverage: refunded ? withRefund / refunded : null,
      missingness: {
        settledMissingPayoutLines: settled - withPayout,
        refundedMissingRefundLines: refunded - withRefund,
      },
      activeSettlementSemantics: true,
      lineBetTypeBound: true,
      readOnly: true,
    };
    const outputDigest = canonicalHash(summary);
    const outputs: string[] = [];
    if (!ctx.dryRun) {
      const relative = "reports/n2/n2-feature-coverage-audit.json";
      atomicWriteJson(join(ctx.repoRoot, relative), {
        ...summary,
        runId: ctx.runId,
        requestId: ctx.requestId,
        taskId: ctx.taskId,
        executorVersion: EXECUTOR_VERSION,
        generatedAt: new Date().toISOString(),
        outputDigest,
      }, true);
      const verified = verifyJsonReadback(join(ctx.repoRoot, relative), outputDigest);
      if (!verified.ok) return {
        result: "FAILED",
        executorVersion: EXECUTOR_VERSION,
        summary,
        outputs: [],
        outputDigest,
        blocks: verified.errors,
      };
      outputs.push(relative);
    }
    return { result: "PASS", executorVersion: EXECUTOR_VERSION, summary, outputs, outputDigest, blocks: [] };
  } finally {
    db.close();
  }
};
