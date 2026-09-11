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
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/all-bet-types-roi.md";
const OUT_JSON = "reports/all-bet-types-roi.json";
const internalPath = fileURLToPath(new URL("./analyze-all-bet-types-roi-internal.ts", import.meta.url));
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

function atomicPublish(path: string, content: string, errorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, errorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const audit = run("scripts/audit-all-bet-types-payout-completeness.ts");
if (audit !== 0) {
  console.error("[all-bet-types-roi] FAIL CLOSED: official payout settlement coverage is incomplete; ROI analysis was not generated");
  process.exit(audit);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID",
);

assertExistingOutputIdentity(OUT_MD, "ALL_BET_TYPES_ROI_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ALL_BET_TYPES_ROI_JSON_PREEXISTING_IDENTITY_INVALID");

const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "ALL_BET_TYPES_ROI_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-all-bet-types-roi-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const isolatedDbPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "ALL_BET_TYPES_ROI_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID",
  );
  const loader = `await import(${JSON.stringify(pathToFileURL(internalPath).href)})`;
  const analysis = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", loader],
    {
      cwd: workspace,
      env: { ...process.env, BOAT_PON_DB_PATH: isolatedDbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (analysis.error || analysis.status !== 0) {
    throw new Error("ALL_BET_TYPES_ROI_INTERNAL_FAILED");
  }

  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd) || !existsSync(workspaceJson)) {
    throw new Error("ALL_BET_TYPES_ROI_OUTPUT_MISSING");
  }
  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "ALL_BET_TYPES_ROI_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "ALL_BET_TYPES_ROI_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(verifiedMdPath, "utf8")
    .split(isolatedDbPath)
    .join("verified read-only research DB");
  const json = readFileSync(verifiedJsonPath, "utf8")
    .split(isolatedDbPath)
    .join("verified read-only research DB");

  mkdirSync("reports", { recursive: true });
  atomicPublish(OUT_MD, markdown, "ALL_BET_TYPES_ROI_MD_PUBLISH_TEMP_IDENTITY_INVALID");
  atomicPublish(OUT_JSON, json, "ALL_BET_TYPES_ROI_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
