// N2 selection-level label profile.
// Immutable/read-only sidecarを独立に2回openし、全selection labelの再生成一致を検証する。
// parser v1 archive semanticsを含む現sidecarはSTALE扱いのため、学習truthへ昇格させない。
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCurrentlyValidSourceDuplicateObservationIds } from "../src/research-replay/n1SourceDuplicateResolutionValidation";
import { readN2SelectionProfileSource } from "../src/research-replay/n2SelectionProfileSource";
import type { N2SelectionProfile } from "../src/research-replay/n2SelectionProfile";

const root = resolve(process.cwd());
const SIDECAR = join(root, "data", "research-replay.sqlite");
const REPORT_DIR = join(root, "reports", "n2");
const PROTO_MONTH = process.argv.find((arg) => arg.startsWith("--month="))
  ?.slice("--month=".length) ?? "2026-05";

function readProfileFromFreshConnection(): N2SelectionProfile {
  const db = new DatabaseSync(`file:${SIDECAR}?immutable=1`, { readOnly: true } as never);
  try {
    // Each independent rebuild must fail closed if append-only duplicate-resolution evidence is stale or forged.
    readCurrentlyValidSourceDuplicateObservationIds(db);
    return readN2SelectionProfileSource(db, PROTO_MONTH);
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
    scope: "immutable/read-only N1 sidecar; active canonical settlements only; all 7 bet types × every canonical selection; no features/model/DB writes",
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
