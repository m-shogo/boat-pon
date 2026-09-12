import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/one-four-structure.md";
const OUT_JSON = "reports/one-four-structure.json";
const internalPath = fileURLToPath(new URL("./analyze-one-four-structure-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function assertExistingOutputIdentity(path: string, code: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, code);
}

function assertGeneratedOutputIdentity(path: string, missingCode: string, invalidCode: string): string {
  if (!existsSync(path)) throw new Error(missingCode);
  return assertCanonicalSingleLinkRegularFile(path, invalidCode);
}

function atomicPublish(
  path: string,
  contents: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(path, destinationErrorCode);
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const audit = run("scripts/audit-all-bet-types-payout-completeness.ts");
if (audit !== 0) {
  console.error("[one-four-structure] FAIL CLOSED: official payout settlement coverage is incomplete; structure analysis was not generated");
  process.exit(audit);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("ONE_FOUR_STRUCTURE_DB_MISSING");
}
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ONE_FOUR_STRUCTURE_DB_HANDOFF_IDENTITY_INVALID",
);

assertExistingOutputIdentity(OUT_MD, "ONE_FOUR_STRUCTURE_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ONE_FOUR_STRUCTURE_JSON_PREEXISTING_IDENTITY_INVALID");

const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "ONE_FOUR_STRUCTURE_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-one-four-structure-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "ONE_FOUR_STRUCTURE_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (analysis.error || analysis.status !== 0) {
    throw new Error("ONE_FOUR_STRUCTURE_INTERNAL_FAILED");
  }

  const workspaceMd = assertGeneratedOutputIdentity(
    join(workspace, OUT_MD),
    "ONE_FOUR_STRUCTURE_MD_WORKSPACE_OUTPUT_MISSING",
    "ONE_FOUR_STRUCTURE_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const workspaceJson = assertGeneratedOutputIdentity(
    join(workspace, OUT_JSON),
    "ONE_FOUR_STRUCTURE_JSON_WORKSPACE_OUTPUT_MISSING",
    "ONE_FOUR_STRUCTURE_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(workspaceMd, "utf8");
  const json = readFileSync(workspaceJson, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "ONE_FOUR_STRUCTURE_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "ONE_FOUR_STRUCTURE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ONE_FOUR_STRUCTURE_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ONE_FOUR_STRUCTURE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );

  if (!existsSync(OUT_MD) || !existsSync(OUT_JSON)) {
    throw new Error("ONE_FOUR_STRUCTURE_OUTPUT_MISSING");
  }
  assertCanonicalSingleLinkRegularFile(OUT_MD, "ONE_FOUR_STRUCTURE_MD_OUTPUT_IDENTITY_INVALID");
  assertCanonicalSingleLinkRegularFile(OUT_JSON, "ONE_FOUR_STRUCTURE_JSON_OUTPUT_IDENTITY_INVALID");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
