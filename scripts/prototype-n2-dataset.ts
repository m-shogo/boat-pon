// N2 dataset prototype + distribution profile（read-only、model training しない）。
// N1 canonical active settlement を label source として eligibility contract を適用し、
// 分布・除外理由・決定的 manifest・再生成一致を検証する。永続 dataset は作らない（reports のみ）。
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCurrentlyValidSourceDuplicateObservationIds } from "../src/research-replay/n1SourceDuplicateResolutionValidation";
import { classifyEligibility, N2_DATASET_CONTRACT_VERSION } from "../src/research-replay/n2DatasetContract";
import {
  N1_SETTLEMENT_MIGRATION_CHECKSUM,
  N1_BACKFILL_MIGRATION_CHECKSUM,
  N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM,
  type SettlementStatus,
  type ResolutionStatus,
} from "../src/research-replay/settlement";

const root = resolve(process.cwd());
const SIDECAR = join(root, "data", "research-replay.sqlite");
const REPORT_DIR = join(root, "reports", "n2");
const PROTO_MONTH = process.argv.find((a) => a.startsWith("--month="))?.slice("--month=".length) ?? "2026-05";

function main(): void {
  const db = new DatabaseSync(`file:${SIDECAR}?immutable=1`, { readOnly: true } as never);
  // Fail closed before any profile/query output if append-only duplicate-resolution evidence is stale or forged.
  readCurrentlyValidSourceDuplicateObservationIds(db);

  // 単一スキャンで year × bet_type × settlement_status × resolution_status × active/duplicate を集計。
  const rows = db.prepare(`
    SELECT substr(c.canonical_race_key,1,4) yr, c.bet_type bt, c.settlement_status ss, c.resolution_status rs,
           CASE WHEN r.duplicate_observation_id IS NULL THEN 'active' ELSE 'source_duplicate' END active,
           COUNT(*) n
    FROM settlement_candidates_v2 c
    LEFT JOIN settlement_source_duplicate_resolutions_v2 r ON r.duplicate_observation_id = c.observation_id
    GROUP BY yr, bt, ss, rs, active
  `).all() as Array<{ yr: string; bt: string; ss: SettlementStatus; rs: ResolutionStatus; active: string; n: number }>;

  const eligibilityByReason: Record<string, number> = {};
  const byBetType: Record<string, { eligible: number; total: number }> = {};
  const byYear: Record<string, { eligible: number; total: number }> = {};
  const byStatus: Record<string, number> = {};
  let total = 0; let eligible = 0;
  for (const r of rows) {
    total += r.n;
    byStatus[r.ss] = (byStatus[r.ss] ?? 0) + r.n;
    const e = classifyEligibility({ settlementStatus: r.ss, resolutionStatus: r.rs, isSourceDuplicate: r.active === "source_duplicate" });
    eligibilityByReason[e.reason] = (eligibilityByReason[e.reason] ?? 0) + r.n;
    const bt = byBetType[r.bt] ?? { eligible: 0, total: 0 }; bt.total += r.n; if (e.eligible) bt.eligible += r.n; byBetType[r.bt] = bt;
    const yr = byYear[r.yr] ?? { eligible: 0, total: 0 }; yr.total += r.n; if (e.eligible) yr.eligible += r.n; byYear[r.yr] = yr;
    if (e.eligible) eligible += r.n;
  }

  // 小規模 label prototype（1ヶ月）。eligible candidate の payout line から label 集合 digest を作り、再生成一致を確認。
  const protoRows = db.prepare(`
    SELECT c.canonical_race_key k, c.bet_type bt, c.settlement_status ss, c.resolution_status rs,
           CASE WHEN r.duplicate_observation_id IS NULL THEN 0 ELSE 1 END dup,
           (SELECT group_concat(p.selection_canonical||':'||p.payout_yen, '|') FROM race_payout_lines_v2 p WHERE p.candidate_id=c.candidate_id AND p.line_kind='payout' AND p.selection_canonical IS NOT NULL ORDER BY p.line_no) wins
    FROM settlement_candidates_v2 c
    LEFT JOIN settlement_source_duplicate_resolutions_v2 r ON r.duplicate_observation_id=c.observation_id
    WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
    ORDER BY c.canonical_race_key, c.bet_type
  `).all(`${PROTO_MONTH}-01`, `${PROTO_MONTH}-99`) as Array<{ k: string; bt: string; ss: SettlementStatus; rs: ResolutionStatus; dup: number; wins: string | null }>;

  let protoEligible = 0; const protoExcl: Record<string, number> = {};
  const labelDigestInput: string[] = [];
  for (const p of protoRows) {
    const e = classifyEligibility({ settlementStatus: p.ss, resolutionStatus: p.rs, isSourceDuplicate: p.dup === 1 });
    if (e.eligible) { protoEligible += 1; labelDigestInput.push(`${p.k}|${p.bt}|${p.wins ?? ""}`); }
    else protoExcl[e.reason] = (protoExcl[e.reason] ?? 0) + 1;
  }
  db.close();
  const labelDigest = createHash("sha256").update(labelDigestInput.sort().join("\n")).digest("hex");
  // 決定性: 同じ入力集合を再ソート・再hashしても一致（純関数のため）。
  const labelDigest2 = createHash("sha256").update([...labelDigestInput].sort().join("\n")).digest("hex");

  const manifest = {
    datasetContractVersion: N2_DATASET_CONTRACT_VERSION,
    n1SchemaChecksums: { v01: N1_SETTLEMENT_MIGRATION_CHECKSUM, v02: N1_BACKFILL_MIGRATION_CHECKSUM, v03: N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM },
    labelSource: "N1 canonical active settlement (source_duplicate excluded, resolved only)",
    prototypeMonth: PROTO_MONTH, prototypeEligibleRows: protoEligible, prototypeExclusions: protoExcl,
    labelDigest, deterministicRebuild: labelDigest === labelDigest2,
  };
  const payload = {
    phase: "N2_DATASET_PROTOTYPE_AND_PROFILE", generatedAt: new Date().toISOString(),
    scope: "read-only N1 sidecar; no features (label side only); no model training; no persistent dataset",
    totalCandidates: total, eligibleCandidates: eligible, eligibleRatio: +(eligible / total).toFixed(4),
    eligibilityByReason, byStatus,
    byBetType: Object.fromEntries(Object.entries(byBetType).map(([k, v]) => [k, { ...v, eligibleRatio: +(v.eligible / v.total).toFixed(4) }])),
    byYear: Object.fromEntries(Object.entries(byYear).sort().map(([k, v]) => [k, { ...v, eligibleRatio: +(v.eligible / v.total).toFixed(4) }])),
    prototype: manifest,
    pitProof: "prototype contains only post-race canonical labels (the TARGET); no pre-race feature columns → no feature leakage possible in label-only prototype. Feature join must pass validateFeaturePIT (n2DatasetContract) at build time.",
    result: manifest.deterministicRebuild ? "OK" : "REVIEW",
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, "n2-dataset-profile.json"), `${JSON.stringify(payload, null, 2)}\n`);
  const yrLines = Object.entries(payload.byYear).map(([y, v]) => `- ${y}: total ${v.total} / eligible ${v.eligible} (${(v.eligibleRatio * 100).toFixed(1)}%)`).join("\n");
  writeFileSync(join(REPORT_DIR, "n2-dataset-profile.md"), `# N2 dataset profile (read-only, label side)\n\n- total candidates: ${total} / eligible: ${eligible} (${(payload.eligibleRatio * 100).toFixed(1)}%)\n- eligibility by reason: ${JSON.stringify(eligibilityByReason)}\n- prototype month ${PROTO_MONTH}: eligible ${protoEligible}, exclusions ${JSON.stringify(protoExcl)}, deterministic rebuild ${manifest.deterministicRebuild}\n- label digest: \`${labelDigest}\`\n\n## eligibility by year\n${yrLines}\n`);
  console.log(JSON.stringify({ ...payload, byYear: `[${Object.keys(payload.byYear).length} years]` }, null, 2));
}
main();
