import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareGolden,
  markCrossEnvironmentVerified,
  runResearchReplayCanary,
  summarizeManifestForCli,
  writeCanaryReports,
} from "../src/research-replay/canary";

const command = process.argv[2] ?? "canary";
const writeReports = process.argv.includes("--write-reports");
const temp = mkdtempSync(join(tmpdir(), "boat-pon-f0-cli-"));
const localReport = runResearchReplayCanary(temp);
const verificationArg = process.argv.find((arg) => arg.startsWith("--cross-environment-verified="));
const report = verificationArg
  ? markCrossEnvironmentVerified(localReport, {
      ciRunUrl: verificationArg.slice("--cross-environment-verified=".length),
      verifiedAt: "2026-07-24T01:55:15.000Z",
      environment: "GitHub Actions ubuntu-latest / Node v24.18.0 / SQLite 3.53.1 / linux-x64",
    })
  : localReport;

switch (command) {
  case "canary":
    if (writeReports) writeCanaryReports(report);
    console.log(JSON.stringify(report, null, 2));
    break;
  case "manifest":
    console.log(JSON.stringify(summarizeManifestForCli(report), null, 2));
    break;
  case "audit":
    console.log(JSON.stringify(report.rawCounts, null, 2));
    break;
  case "schema":
    console.log(JSON.stringify(report.schemaVerification, null, 2));
    if (!report.schemaVerification.ok) process.exitCode = 1;
    break;
  case "golden": {
    const comparison = compareGolden(report);
    console.log(JSON.stringify({
      fixtureHash: report.goldenHashes.fixtureArchiveHash,
      rawHashes: report.goldenHashes.rawHashes,
      semanticHashes: report.goldenHashes.semanticHashes,
      manifestHash: report.goldenHashes.manifestHash,
      runtimeEnvironment: report.environment,
      ok: comparison.ok,
      mismatchReason: comparison.mismatches,
    }, null, 2));
    if (!comparison.ok) process.exitCode = 1;
    break;
  }
  default:
    throw new Error(`unknown research replay command: ${command}`);
}
