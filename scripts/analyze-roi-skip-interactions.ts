/**
 * analyze-roi-skip-interactions.ts — research-only fail-closed entrypoint
 *
 * Missing official trifecta settlement coverage must not become a synthetic
 * zero-return observation in skip/intersection residual analysis.
 */

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

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-skip-interactions.md";
const OUT_JSON = "reports/roi-skip-interactions.json";
const OPAQUE_DB_SOURCE = "primary research database";
const corePath = fileURLToPath(new URL("./analyze-roi-skip-interactions-core.ts", import.meta.url));
const coreUrl = pathToFileURL(corePath).href;
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[skip-interactions] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function atomicPublish(
  targetPath: string,
  content: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(targetPath)) {
      assertCanonicalSingleLinkRegularFile(targetPath, destinationErrorCode);
    }
    renameSync(verifiedTempPath, targetPath);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function redactDbProvenance(content: string, dbPath: string): string {
  const privateMarker = `DB: ${dbPath}`;
  if (!content.includes(privateMarker)) {
    throw new Error("ROI_SKIP_INTERACTIONS_PRIVATE_DB_PROVENANCE_MARKER_MISSING");
  }
  const redacted = content.replaceAll(privateMarker, `DB: ${OPAQUE_DB_SOURCE}`);
  if (redacted.includes(dbPath)) {
    throw new Error("ROI_SKIP_INTERACTIONS_PRIVATE_DB_PATH_REMAINS");
  }
  return redacted;
}

const preflight = run("scripts/audit-roi-skip-interactions-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[skip-interactions] FAIL CLOSED: official trifecta settlement coverage is incomplete; skip/intersection verdicts were not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) {
  throw new Error("ROI_SKIP_INTERACTIONS_PRIMARY_DB_MISSING");
}
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID",
);

for (const path of [OUT_MD, OUT_JSON]) {
  if (existsSync(path)) {
    assertCanonicalSingleLinkRegularFile(
      path,
      "ROI_SKIP_INTERACTIONS_PREEXISTING_REPORT_IDENTITY_INVALID",
    );
  }
}

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-skip-interactions-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });

  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "ROI_SKIP_INTERACTIONS_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", `await import(${JSON.stringify(coreUrl)})`],
    {
      cwd: workspace,
      env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (analysis.error || analysis.status !== 0) {
    throw new Error("ROI_SKIP_INTERACTIONS_CORE_FAILED");
  }

  const stagedMd = join(workspace, OUT_MD);
  const stagedJson = join(workspace, OUT_JSON);
  if (!existsSync(stagedMd)) throw new Error("ROI_SKIP_INTERACTIONS_MD_OUTPUT_MISSING");
  if (!existsSync(stagedJson)) throw new Error("ROI_SKIP_INTERACTIONS_JSON_OUTPUT_MISSING");

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    stagedMd,
    "ROI_SKIP_INTERACTIONS_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    stagedJson,
    "ROI_SKIP_INTERACTIONS_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = redactDbProvenance(readFileSync(verifiedMdPath, "utf-8"), launchDbPath);
  const json = readFileSync(verifiedJsonPath, "utf-8");
  if (json.includes(launchDbPath)) {
    throw new Error("ROI_SKIP_INTERACTIONS_JSON_PRIVATE_DB_PATH_REMAINS");
  }

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "ROI_SKIP_INTERACTIONS_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_SKIP_INTERACTIONS_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ROI_SKIP_INTERACTIONS_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_SKIP_INTERACTIONS_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[skip-interactions] PASS: settlement completeness preflight passed before isolated interaction analysis publication");
