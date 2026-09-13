/**
 * Canonical read-only entrypoint for the racer ability audit.
 *
 * This wrapper keeps the legacy aggregation isolated in a temporary workspace,
 * validates the research DB and frozen candidate artifact identities before use,
 * and removes filesystem provenance before publishing reports.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
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
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const configuredCandidatesPath = "data/exacta-forward-candidates.json";
const outMd = "reports/racer-ability-data-audit.md";
const outJson = "reports/racer-ability-data-audit.json";
const internalPath = fileURLToPath(new URL("./report-racer-ability-audit-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function assertCanonicalDirectory(path: string, code: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(code);
  return resolvedPath;
}

function verifyExistingOutput(path: string, code: string): void {
  if (existsSync(path)) assertCanonicalSingleLinkRegularFile(path, code);
}

function verifyExistingOutputs(): void {
  verifyExistingOutput(
    outJson,
    "RACER_ABILITY_AUDIT_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  verifyExistingOutput(
    outMd,
    "RACER_ABILITY_AUDIT_MARKDOWN_PREPUBLISH_DESTINATION_IDENTITY_INVALID",
  );
}

function atomicPublish(path: string, content: string): void {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, "RACER_ABILITY_AUDIT_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      "RACER_ABILITY_AUDIT_PUBLISH_TEMP_IDENTITY_INVALID",
    );
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(
        path,
        "RACER_ABILITY_AUDIT_PUBLISH_DESTINATION_IDENTITY_INVALID",
      );
    }
    assertCanonicalDirectory(
      parentPath,
      "RACER_ABILITY_AUDIT_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID",
    );
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

if (!existsSync(configuredDbPath)) throw new Error("RACER_ABILITY_AUDIT_DB_MISSING");
if (!existsSync(configuredCandidatesPath)) throw new Error("RACER_ABILITY_AUDIT_CANDIDATES_MISSING");

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "RACER_ABILITY_AUDIT_DB_IDENTITY_INVALID",
);
const verifiedCandidatesPath = assertCanonicalSingleLinkRegularFile(
  configuredCandidatesPath,
  "RACER_ABILITY_AUDIT_CANDIDATES_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-racer-ability-"));
try {
  const workspaceCandidates = join(workspace, configuredCandidatesPath);
  mkdirSync(dirname(workspaceCandidates), { recursive: true });
  mkdirSync(join(workspace, "reports"), { recursive: true });

  const handoffCandidatesSourcePath = assertCanonicalSingleLinkRegularFile(
    verifiedCandidatesPath,
    "RACER_ABILITY_AUDIT_CANDIDATES_SOURCE_HANDOFF_IDENTITY_INVALID",
  );
  copyFileSync(handoffCandidatesSourcePath, workspaceCandidates);

  const handoffDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "RACER_ABILITY_AUDIT_DB_HANDOFF_IDENTITY_INVALID",
  );
  const stagedCandidatesPath = assertCanonicalSingleLinkRegularFile(
    workspaceCandidates,
    "RACER_ABILITY_AUDIT_CANDIDATES_HANDOFF_IDENTITY_INVALID",
  );
  const childDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "RACER_ABILITY_AUDIT_DB_CHILD_HANDOFF_IDENTITY_INVALID",
  );
  assertCanonicalSingleLinkRegularFile(
    stagedCandidatesPath,
    "RACER_ABILITY_AUDIT_CANDIDATES_CHILD_HANDOFF_IDENTITY_INVALID",
  );
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "RACER_ABILITY_AUDIT_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  assertCanonicalSingleLinkRegularFile(
    stagedCandidatesPath,
    "RACER_ABILITY_AUDIT_CANDIDATES_CHILD_LAUNCH_IDENTITY_INVALID",
  );

  const child = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.status !== 0) throw new Error("RACER_ABILITY_AUDIT_INTERNAL_FAILED");

  const generatedJsonPath = join(workspace, outJson);
  const generatedMdPath = join(workspace, outMd);
  if (!existsSync(generatedJsonPath) || !existsSync(generatedMdPath)) {
    throw new Error("RACER_ABILITY_AUDIT_OUTPUT_MISSING");
  }

  const generatedJsonReadPath = assertCanonicalSingleLinkRegularFile(
    generatedJsonPath,
    "RACER_ABILITY_AUDIT_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const report = JSON.parse(readFileSync(generatedJsonReadPath, "utf8")) as Record<string, unknown>;
  delete report.dbPath;
  report.dbProvenance = "verified-read-only-research-db";

  const generatedMdReadPath = assertCanonicalSingleLinkRegularFile(
    generatedMdPath,
    "RACER_ABILITY_AUDIT_MARKDOWN_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(generatedMdReadPath, "utf8").replace(
    /^DB: .*$/mu,
    "DB: verified read-only research DB",
  );

  // Validate the canonical parent and complete paired destination set before
  // the first replacement so a bad sibling fails closed without partial publication.
  mkdirSync("reports", { recursive: true });
  assertCanonicalDirectory("reports", "RACER_ABILITY_AUDIT_REPORTS_DIRECTORY_IDENTITY_INVALID");
  verifyExistingOutputs();
  atomicPublish(outJson, `${JSON.stringify(report, null, 2)}\n`);
  atomicPublish(outMd, markdown);

  console.log("[report-racer-ability-audit] completed with verified research inputs");
  console.log(`[report-racer-ability-audit] wrote ${outMd}`);
  console.log(`[report-racer-ability-audit] wrote ${outJson}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
