/**
 * report-paper-forward-monitor.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the historical
 * paper-forward monitor emits payout ROI, switch/exclusion trends, or upgrade verdicts.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/paper-forward-monitor.md";
const OUT_JSON = "reports/paper-forward-monitor.json";
const OPAQUE_DB_SOURCE = "primary research database";
const internalPath = fileURLToPath(new URL("./report-paper-forward-monitor-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], { stdio: "inherit", env });
  if (result.error) {
    console.error(`[paper-forward-monitor-entrypoint] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function assertCanonicalDirectory(path: string, code: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(code);
  return resolvedPath;
}

function verifyExistingOutputs(): void {
  if (existsSync(OUT_MD)) {
    assertCanonicalSingleLinkRegularFile(OUT_MD, "PAPER_FORWARD_MONITOR_PREEXISTING_REPORT_IDENTITY_INVALID");
  }
  if (existsSync(OUT_JSON)) {
    assertCanonicalSingleLinkRegularFile(OUT_JSON, "PAPER_FORWARD_MONITOR_PREEXISTING_JSON_IDENTITY_INVALID");
  }
}

function atomicPublish(path: string, content: string, tempCode: string, destinationCode: string): void {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, "PAPER_FORWARD_MONITOR_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempCode);
    if (existsSync(path)) assertCanonicalSingleLinkRegularFile(path, destinationCode);
    assertCanonicalDirectory(parentPath, "PAPER_FORWARD_MONITOR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function runIsolated(workspace: string, verifiedDbPath: string): number {
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "PAPER_FORWARD_MONITOR_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const loader = `await import(${JSON.stringify(pathToFileURL(internalPath).href)})`;
  const result = spawnSync(process.execPath, ["--import", tsxLoader, "--input-type=module", "--eval", loader], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BOAT_PON_DB_PATH: launchDbPath,
      BOAT_PON_PAPER_FORWARD_MONITOR_INTERNAL_GUARD: "1",
    },
  });
  if (result.error) throw new Error("PAPER_FORWARD_MONITOR_INTERNAL_SPAWN_FAILED");
  const status = result.status ?? 1;
  if (status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    return status;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  return status;
}

function readStagedOutputs(workspace: string, handoffDbPath: string): { markdown: string; json: string } {
  const stagedMdPath = join(workspace, OUT_MD);
  const stagedJsonPath = join(workspace, OUT_JSON);
  if (!existsSync(stagedMdPath)) throw new Error("PAPER_FORWARD_MONITOR_REPORT_MISSING_AFTER_INTERNAL_SUCCESS");
  if (!existsSync(stagedJsonPath)) throw new Error("PAPER_FORWARD_MONITOR_JSON_MISSING_AFTER_INTERNAL_SUCCESS");

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(stagedMdPath, "PAPER_FORWARD_MONITOR_REPORT_IDENTITY_INVALID");
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(stagedJsonPath, "PAPER_FORWARD_MONITOR_JSON_IDENTITY_INVALID");
  const markdown = readFileSync(verifiedMdPath, "utf-8");
  const json = readFileSync(verifiedJsonPath, "utf-8");
  const dbLines = markdown.match(/^DB:.*$/gm) ?? [];
  if (dbLines.length !== 1 || dbLines[0] !== `DB: ${OPAQUE_DB_SOURCE}`) {
    throw new Error("PAPER_FORWARD_MONITOR_DB_PROVENANCE_UNEXPECTED");
  }
  if (markdown.includes(handoffDbPath) || json.includes(handoffDbPath)) {
    throw new Error("PAPER_FORWARD_MONITOR_PRIVATE_DB_PATH_REMAINS");
  }
  try {
    JSON.parse(json);
  } catch {
    throw new Error("PAPER_FORWARD_MONITOR_JSON_INVALID");
  }
  assertCanonicalSingleLinkRegularFile(verifiedMdPath, "PAPER_FORWARD_MONITOR_REPORT_HANDOFF_IDENTITY_INVALID");
  assertCanonicalSingleLinkRegularFile(verifiedJsonPath, "PAPER_FORWARD_MONITOR_JSON_HANDOFF_IDENTITY_INVALID");
  return { markdown, json };
}

const preflight = run("scripts/audit-paper-forward-monitor-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-monitor-entrypoint] FAIL CLOSED: official trifecta settlement coverage is incomplete; monitor ROI/trend/verdict output was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "PAPER_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID",
);
verifyExistingOutputs();

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-paper-forward-monitor-"));
let status = 1;
try {
  status = runIsolated(workspace, handoffDbPath);
  if (status === 0) {
    const outputs = readStagedOutputs(workspace, handoffDbPath);
    mkdirSync("reports", { recursive: true });
    assertCanonicalDirectory("reports", "PAPER_FORWARD_MONITOR_REPORTS_DIRECTORY_IDENTITY_INVALID");
    verifyExistingOutputs();
    atomicPublish(
      OUT_MD,
      outputs.markdown,
      "PAPER_FORWARD_MONITOR_MD_PUBLISH_TEMP_IDENTITY_INVALID",
      "PAPER_FORWARD_MONITOR_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
    atomicPublish(
      OUT_JSON,
      outputs.json,
      "PAPER_FORWARD_MONITOR_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
      "PAPER_FORWARD_MONITOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (status !== 0) {
  console.error("[paper-forward-monitor-entrypoint] internal report failed after a successful payout completeness preflight");
  process.exit(status);
}
console.log("[paper-forward-monitor-entrypoint] PASS: payout completeness preflight passed before isolated monitor publication");
