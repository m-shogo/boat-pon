import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  runF0RReadiness,
  writeF0RReadinessReports,
} from "../src/research-replay/readiness";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const tempRootArg = process.argv.find((arg) => arg.startsWith("--root="));
const deploymentRoot = tempRootArg ? tempRootArg.slice("--root=".length) : root;
const sidecarPath = dryRun
  ? join(deploymentRoot, "tmp", "research-replay-dry-run.sqlite")
  : join(deploymentRoot, "data", "research-replay.sqlite");
const rawRoot = dryRun
  ? join(deploymentRoot, "tmp", "research-replay-dry-run-raw")
  : join(deploymentRoot, "data", "research-replay-raw");
let primarySourcePath = join(root, "data", "boat.sqlite");
if (dryRun && !existsSync(primarySourcePath)) {
  primarySourcePath = join(deploymentRoot, "tmp", "primary-fixture.sqlite");
  mkdirSync(join(deploymentRoot, "tmp"), { recursive: true, mode: 0o700 });
  const fixture = new DatabaseSync(primarySourcePath);
  fixture.exec(`
    CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO app_settings VALUES ('fixture_mode', 'read_only_fingerprint');
  `);
  fixture.close();
}
const backupDirectory = dryRun
  ? join(deploymentRoot, "tmp", "research-replay-backups")
  : join(root, "backups", "research-replay");

const report = runF0RReadiness({
  sidecarPath,
  rawRoot,
  primarySourcePath,
  backupDirectory,
  rolloutStartedAt: new Date().toISOString(),
  executionMode: dryRun ? "simulated" : "production",
  reportRoot: dryRun ? deploymentRoot : root,
});

if (!dryRun || process.argv.includes("--write-reports")) {
  writeF0RReadinessReports(report, root);
}
console.log(JSON.stringify(report, null, 2));
if (report.status !== "COMPLETE") process.exitCode = 1;
