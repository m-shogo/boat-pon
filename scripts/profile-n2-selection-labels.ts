// N2 selection-level label profile.
// Immutable/read-only sidecarを独立に2回openし、全selection labelの再生成一致を検証する。
// parser v1 archive semanticsを含む現sidecarはSTALE扱いのため、学習truthへ昇格させない。
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildN2SelectionProfile,
  type N2PayoutLineInput,
  type N2RefundLineInput,
  type N2SelectionProfile,
  type N2SelectionProfileCandidate,
} from "../src/research-replay/n2SelectionProfile";
import type {
  ResolutionStatus,
  SettlementBetType,
  SettlementStatus,
} from "../src/research-replay/settlement";

const root = resolve(process.cwd());
const SIDECAR = join(root, "data", "research-replay.sqlite");
const REPORT_DIR = join(root, "reports", "n2");
const PROTO_MONTH = process.argv.find((arg) => arg.startsWith("--month="))
  ?.slice("--month=".length) ?? "2026-05";

type CandidateRow = {
  id: string;
  raceKey: string;
  betType: SettlementBetType;
  settlementStatus: SettlementStatus;
  resolutionStatus: ResolutionStatus;
  duplicate: number;
};
type PayoutRow = {
  candidateId: string;
  selection: string | null;
  payoutYen: number;
  lineKind: "payout" | "special_payout";
};
type RefundRow = {
  candidateId: string;
  selection: string | null;
  scope: "selection" | "bet_type" | "race";
  refundYenPer100: number | null;
};

function readProfileFromFreshConnection(): N2SelectionProfile {
  const db = new DatabaseSync(`file:${SIDECAR}?immutable=1`, { readOnly: true } as never);
  try {
    const lower = `${PROTO_MONTH}-01`;
    const upper = `${PROTO_MONTH}-99`;
    const candidates = db.prepare(`
      SELECT c.candidate_id id,
             c.canonical_race_key raceKey,
             c.bet_type betType,
             c.settlement_status settlementStatus,
             c.resolution_status resolutionStatus,
             CASE WHEN d.duplicate_observation_id IS NULL THEN 0 ELSE 1 END duplicate
      FROM settlement_candidates_v2 c
      LEFT JOIN settlement_source_duplicate_resolutions_v2 d
        ON d.duplicate_observation_id = c.observation_id
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
      ORDER BY c.canonical_race_key, c.bet_type, c.candidate_id
    `).all(lower, upper) as CandidateRow[];

    const payouts = db.prepare(`
      SELECT p.candidate_id candidateId,
             p.selection_canonical selection,
             p.payout_yen payoutYen,
             p.line_kind lineKind
      FROM race_payout_lines_v2 p
      JOIN settlement_candidates_v2 c ON c.candidate_id = p.candidate_id
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
      ORDER BY c.canonical_race_key, c.bet_type, c.candidate_id, p.line_no
    `).all(lower, upper) as PayoutRow[];

    const refunds = db.prepare(`
      SELECT f.candidate_id candidateId,
             f.selection_canonical selection,
             f.refund_scope scope,
             f.refund_yen_per_100 refundYenPer100
      FROM race_refund_lines_v2 f
      JOIN settlement_candidates_v2 c ON c.candidate_id = f.candidate_id
      WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
      ORDER BY c.canonical_race_key, c.bet_type, c.candidate_id, f.line_no
    `).all(lower, upper) as RefundRow[];

    const payoutsByCandidate = new Map<string, N2PayoutLineInput[]>();
    for (const row of payouts) {
      const lines = payoutsByCandidate.get(row.candidateId) ?? [];
      lines.push({ selection: row.selection, payoutYen: row.payoutYen, lineKind: row.lineKind });
      payoutsByCandidate.set(row.candidateId, lines);
    }
    const refundsByCandidate = new Map<string, N2RefundLineInput[]>();
    for (const row of refunds) {
      const lines = refundsByCandidate.get(row.candidateId) ?? [];
      lines.push({
        selection: row.selection,
        scope: row.scope,
        refundYenPer100: row.refundYenPer100,
      });
      refundsByCandidate.set(row.candidateId, lines);
    }

    const input: N2SelectionProfileCandidate[] = candidates.map((row) => ({
      candidateId: row.id,
      canonicalRaceKey: row.raceKey,
      betType: row.betType,
      settlementStatus: row.settlementStatus,
      resolutionStatus: row.resolutionStatus,
      isSourceDuplicate: row.duplicate === 1,
      payouts: payoutsByCandidate.get(row.id) ?? [],
      refunds: refundsByCandidate.get(row.id) ?? [],
    }));
    return buildN2SelectionProfile(input);
  } finally {
    db.close();
  }
}

function main(): void {
  const first = readProfileFromFreshConnection();
  // 1回目のDatabaseSyncはclose済み。別connectionでDB/入力を独立再読込する。
  const second = readProfileFromFreshConnection();
  const independentRebuild =
    first.labelDigest === second.labelDigest
    && first.candidateCount === second.candidateCount
    && first.selectionCount === second.selectionCount
    && JSON.stringify(first.byBetType) === JSON.stringify(second.byBetType);

  const payload = {
    phase: "N2_SELECTION_LEVEL_LABEL_PROFILE",
    generatedAt: new Date().toISOString(),
    prototypeMonth: PROTO_MONTH,
    scope: "immutable/read-only N1 sidecar; all 7 bet types × every canonical selection; no features/model/DB writes",
    labelTruthStatus: "STALE_ARCHIVE_SEMANTICS",
    staleReason: "current sidecar includes n1-settlement-parser-v1 observations; ARCHIVE_REFUND_SEMANTICS_AUDIT raw reparse/reconciliation pending",
    independentRebuild: {
      performed: true,
      separateDatabaseConnections: true,
      firstDigest: first.labelDigest,
      secondDigest: second.labelDigest,
      match: independentRebuild,
    },
    profile: first,
    result: independentRebuild ? "PROFILE_GENERATED_STALE_ARCHIVE_SEMANTICS" : "DETERMINISM_FAILURE",
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    join(REPORT_DIR, "n2-selection-level-profile.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  const rows = Object.entries(first.byBetType).map(([betType, item]) =>
    `| ${betType} | ${item.candidates} | ${item.selections} | ${item.outcomes.hit} | ${item.outcomes.loss} | ${item.outcomes.refund} | ${item.outcomes.special_payout} | ${item.outcomes.void} | ${item.hitRate ?? "—"} | ${item.positivePayoutYenPer100.p50 ?? "—"} | ${item.positivePayoutYenPer100.p99 ?? "—"} |`,
  ).join("\n");
  writeFileSync(join(REPORT_DIR, "n2-selection-level-profile.md"), `# N2 selection-level label profile

- generated: ${payload.generatedAt}
- month: ${PROTO_MONTH}
- candidates: ${first.candidateCount}
- selections: ${first.selectionCount}
- independent DB reread rebuild: ${independentRebuild ? "PASS" : "FAIL"}
- label digest: \`${first.labelDigest}\`
- label truth status: **STALE_ARCHIVE_SEMANTICS**

> This profile must not be used for training until ARCHIVE_REFUND_SEMANTICS_AUDIT and canonical supersession/reconciliation finish.

| bet type | candidates | selections | hit | loss | refund | special | void | hit rate | positive payout p50 | positive payout p99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}
`);
  console.log(JSON.stringify({
    prototypeMonth: PROTO_MONTH,
    candidates: first.candidateCount,
    selections: first.selectionCount,
    labelDigest: first.labelDigest,
    independentRebuild,
    result: payload.result,
  }, null, 2));
  if (!independentRebuild) process.exitCode = 1;
}

main();
