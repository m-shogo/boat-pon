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

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/skip6r-switch-historical-closing-odds.md";
const OUT_JSON = "reports/skip6r-switch-historical-closing-odds.json";
const internalPath = fileURLToPath(
  new URL("./analyze-skip6r-switch-historical-closing-odds-internal.ts", import.meta.url),
);
const tsxLoader = import.meta.resolve("tsx");

function atomicPublish(
  path: string,
  content: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
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

if (!existsSync(DB_PATH)) {
  throw new Error("SKIP6R_SWITCH_HISTORICAL_PRIMARY_DB_MISSING");
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "SKIP6R_SWITCH_HISTORICAL_PRIMARY_DB_IDENTITY_INVALID",
);

function runAudit(script: string): number {
  const auditDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "SKIP6R_SWITCH_HISTORICAL_AUDIT_DB_IDENTITY_INVALID",
  );
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: { ...process.env, BOAT_PON_DB_PATH: auditDbPath },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const audit = runAudit("scripts/audit-skip6r-historical-payout-completeness.ts");
if (audit !== 0) {
  console.error("[skip6r-switch-historical] FAIL CLOSED: official trifecta settlement coverage is incomplete; switch analysis was not generated");
  process.exit(audit);
}

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "SKIP6R_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-skip6r-switch-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });

  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "SKIP6R_SWITCH_HISTORICAL_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (analysis.error || analysis.status !== 0) {
    throw new Error("SKIP6R_SWITCH_HISTORICAL_INTERNAL_FAILED");
  }

  const workspaceJson = join(workspace, OUT_JSON);
  const workspaceMd = join(workspace, OUT_MD);
  if (!existsSync(workspaceJson)) throw new Error("SKIP6R_SWITCH_HISTORICAL_JSON_OUTPUT_MISSING");
  if (!existsSync(workspaceMd)) throw new Error("SKIP6R_SWITCH_HISTORICAL_MD_OUTPUT_MISSING");

  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "SKIP6R_SWITCH_HISTORICAL_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "SKIP6R_SWITCH_HISTORICAL_MD_OUTPUT_IDENTITY_INVALID",
  );
  const json = readFileSync(verifiedJsonPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");
  const markdown = readFileSync(verifiedMdPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_JSON,
    json,
    "SKIP6R_SWITCH_HISTORICAL_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "SKIP6R_SWITCH_HISTORICAL_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_MD,
    markdown,
    "SKIP6R_SWITCH_HISTORICAL_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "SKIP6R_SWITCH_HISTORICAL_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[skip6r-switch-historical] PASS: payout preflight passed before isolated analysis publication");
