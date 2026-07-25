import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  runCapacityBenchmark,
  type CapacityBenchmark,
} from "../src/research-replay/n1CapacityBenchmark";
import {
  runN1PermanentRollout,
  type N1PermanentRolloutReport,
} from "../src/research-replay/n1Rollout";

const root = resolve(process.cwd());
const command = process.argv[2] ?? "readiness";
const writeReports = process.argv.includes("--write-reports");
const now = new Date().toISOString();

const CAPACITY_JSON = join(root, "reports", "n1-settlement-capacity-benchmark.json");
const CAPACITY_MD = join(root, "reports", "n1-settlement-capacity-benchmark.md");
const READINESS_JSON = join(root, "reports", "n1-settlement-permanent-rollout-readiness.json");
const READINESS_MD = join(root, "reports", "n1-settlement-permanent-rollout-readiness.md");

function gib(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function capacityMarkdown(report: CapacityBenchmark): string {
  const p = report.projection;
  const m = report.measurements;
  const c = report.counts;
  return `# N1 settlement capacity benchmark

- benchmark: \`${report.benchmarkVersion}\`
- schema: \`${report.schemaVersion}\` / checksum \`${report.migrationChecksum}\`
- external requests: ${report.externalRequests} / primary writes: ${report.primaryDbWrites} / permanent sidecar writes: ${report.permanentSidecarWrites}
- sample seed: \`${report.sample.seed}\`

## Sample (stratified, deterministic)

- files: ${c.sampleFiles} / races: ${c.races} / venues: ${c.venuesSeen} / decades: ${c.decadesSeen.join(", ")}
- schema families: ${JSON.stringify(c.schemaFamilies)}
- selection rule: ${report.sample.selectionRule}
- special cases observed: refunded ${c.specialCases.refundedCandidates}, partial ${c.specialCases.partiallyRefundedCandidates}, multi-line ${c.specialCases.multiLinePayoutCandidates}, special-payout ${c.specialCases.specialPayoutCandidates}

## Measured

| metric | value |
|---|---:|
| candidates | ${c.settlementCandidates} |
| payout lines | ${c.payoutLines} |
| refund lines | ${c.refundLines} |
| evidence pins | ${c.evidencePins} |
| DB bytes | ${m.dbBytes} |
| WAL peak bytes | ${m.walPeakBytes} |
| backup bytes | ${m.backupBytes} |
| index overhead ratio | ${m.indexOverheadRatio?.toFixed(3) ?? "n/a"} |
| evidence pin share of DB | ${m.evidencePinShareOfDb?.toFixed(3) ?? "n/a"} |
| bytes/race | ${p.bytesPerRace.toFixed(1)} |
| bytes/candidate | ${p.bytesPerCandidate.toFixed(1)} |
| bytes/payout line | ${p.bytesPerPayoutLine.toFixed(1)} |
| bytes/evidence pin | ${p.bytesPerEvidencePin.toFixed(1)} |

## Timings (ms)

migration ${m.timingsMs.migrationMs.toFixed(1)} / insert ${m.timingsMs.insertMs.toFixed(1)} / replay ${m.timingsMs.replayMs.toFixed(1)} / backup ${m.timingsMs.backupMs.toFixed(1)} / restore ${m.timingsMs.restoreMs.toFixed(1)}

## Full-backfill projection (${report.counts.races} → ${8164} files / 1,194,007 races)

| projection | low | base | high |
|---|---:|---:|---:|
| full DB bytes | ${p.projectedFullDbBytes.low} | ${p.projectedFullDbBytes.base} | ${p.projectedFullDbBytes.high} |
| raw store bytes | ${p.projectedRawStoreBytes.low} | ${p.projectedRawStoreBytes.base} | ${p.projectedRawStoreBytes.high} |
| backup bytes | ${p.projectedBackupBytes.low} | ${p.projectedBackupBytes.base} | ${p.projectedBackupBytes.high} |

- projected candidates: ${p.projectedFullCandidates} / payout lines: ${p.projectedFullPayoutLines} / evidence pins: ${p.projectedFullEvidencePins}
- projected DB base: **${gib(p.projectedFullDbBytes.base)}** (low ${gib(p.projectedFullDbBytes.low)} / high ${gib(p.projectedFullDbBytes.high)})
- projected temp free-space requirement: ${gib(p.projectedTempFreeSpaceBytes)}
- WAL amplification: ${p.walAmplification.toFixed(3)} / backup amplification: ${p.backupAmplification.toFixed(3)}

## Quota verdict

- current quota: ${gib(p.currentQuotaBytes)} / disk free: ${gib(p.diskFreeBytes)}
- fits current quota: **${p.fitsCurrentQuota ? "YES" : "NO"}**
- recommended quota: **${gib(p.recommendedQuotaBytes)}**
- recommended low-water: ${gib(p.recommendedLowWaterBytes)}
- recommended backup retention: ${p.recommendedBackupRetention}

> evidence pinがDBの約${((m.evidencePinShareOfDb ?? 0) * 100).toFixed(0)}%を占める。candidate毎に3行の重複pinを保存しており、
> full backfillで約${(p.projectedFullEvidencePins / 1_000_000).toFixed(1)}M行になる。candidate FKを暗黙pinとして扱うOption Bで削減余地がある。
`;
}

function readinessMarkdown(report: N1PermanentRolloutReport): string {
  const gates = Object.entries(report.gates).map(([name, ok]) => `- ${name}: ${ok ? "PASS" : "FAIL"}`).join("\n");
  return `# Phase N1-B permanent settlement schema rollout readiness

- status: **${report.status}**
- applied: **${report.applied}**
- approval: **${report.approval.resolution.code}** (approved=${report.approval.approved})
- schema: before \`${report.schema.beforeVersion ?? "none"}\` → after \`${report.schema.afterVersion ?? "none"}\` (target \`${report.schema.targetVersion}\`)
- checksum: \`${report.schema.migrationChecksum}\` matches=${report.schema.checksumMatches}
- append-only triggers: ${report.schema.appendOnlyTriggerCount}
- permanent N1 row counts: ${JSON.stringify(report.schema.permanentRowCounts)}

## Approval

- scope: \`${report.approval.scope}\`
- target: \`${report.approval.targetStage}\` / \`${report.approval.targetSchemaVersion}\` / \`${report.approval.targetContractVersion}\`
- resolver: \`${report.approval.resolution.resolverVersion}\` / approval id: \`${report.approval.resolution.approvalId ?? "none"}\`
- mode: \`${report.approval.executionMode}\`

## Primary isolation (data/boat.sqlite read-only)

- read-only connection: ${report.primaryIsolationBefore.readOnlyConnection} / query_only: ${report.primaryIsolationBefore.queryOnlyEnforced}
- primary write statements: ${report.primaryIsolationBefore.writeStatementCount} / write connections: ${report.primaryIsolationBefore.writeConnectionCount}
- target is sidecar (not primary): ${report.primaryIsolationBefore.targetIsNotPrimary}
- schema hash unchanged: ${report.primaryUnchanged}
- attached databases: ${JSON.stringify(report.primaryIsolationBefore.attachedDatabases)}

## Pre-migration gate

${Object.entries(report.preMigrationGate).map(([k, v]) => `- ${k}: ${typeof v === "boolean" ? (v ? "PASS" : "FAIL") : v}`).join("\n")}

## Post-migration gate

${report.postMigrationGate ? Object.entries(report.postMigrationGate).map(([k, v]) => `- ${k}: ${typeof v === "boolean" ? (v ? "PASS" : "FAIL") : v}`).join("\n") : "- not applied"}

## Restore-copy canary

${report.canary ? Object.entries(report.canary).map(([k, v]) => `- ${k}: ${v}`).join("\n") : "- not run"}

## Gates

${gates}

## N1-C eligibility

- status: **${report.n1cEligibility.status}**
${report.n1cEligibility.reasons.map((reason) => `- ${reason}`).join("\n")}

## Blockers

${report.blockers.length === 0 ? "- none" : report.blockers.map((blocker) => `- ${blocker}`).join("\n")}
`;
}

function loadCapacity(): CapacityBenchmark | null {
  if (!existsSync(CAPACITY_JSON)) return null;
  return JSON.parse(readFileSync(CAPACITY_JSON, "utf8")) as CapacityBenchmark;
}

async function main(): Promise<void> {
  if (command === "capacity-benchmark") {
    const targetArg = process.argv.find((arg) => arg.startsWith("--target-races="));
    const targetRaces = targetArg ? Number(targetArg.slice("--target-races=".length)) : 10_000;
    const report = await runCapacityBenchmark({
      archiveRoot: join(root, "data", "raw", "official", "results"),
      targetRaces,
      quotaBytes: 1024 * 1024 * 1024,
      generatedAt: now,
    });
    if (writeReports) {
      mkdirSync(join(root, "reports"), { recursive: true });
      writeFileSync(CAPACITY_JSON, `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(CAPACITY_MD, capacityMarkdown(report));
    }
    console.log(JSON.stringify(report.projection, null, 2));
    return;
  }

  if (command === "readiness" || command === "apply") {
    const capacity = loadCapacity();
    const fits = capacity?.projection.fitsCurrentQuota ?? false;
    const pinShare = capacity?.measurements.evidencePinShareOfDb ?? 1;
    const evidencePinReductionRequired = pinShare > 0.15;
    const report = runN1PermanentRollout({
      sidecarPath: join(root, "data", "research-replay.sqlite"),
      rawRoot: join(root, "data", "research-replay-raw"),
      primarySourcePath: join(root, "data", "boat.sqlite"),
      backupDirectory: join(root, "backups", "research-replay"),
      fixturePath: join(root, "tests", "fixtures", "research-replay", "n1-settlement-cases.json"),
      rolloutStartedAt: now,
      executionMode: "production",
      apply: command === "apply",
      capacityFitsQuota: fits,
      evidencePinReductionRequired,
      reportRoot: root,
      generatedAt: now,
    });
    if (writeReports) {
      mkdirSync(join(root, "reports"), { recursive: true });
      writeFileSync(READINESS_JSON, `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(READINESS_MD, readinessMarkdown(report));
    }
    console.log(JSON.stringify({ status: report.status, applied: report.applied, approval: report.approval.resolution.code, blockers: report.blockers, n1c: report.n1cEligibility }, null, 2));
    if (report.status === "BLOCKED") process.exitCode = 1;
    return;
  }

  throw new Error(`unknown N1-B rollout command: ${command}`);
}

await main();
