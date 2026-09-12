/**
 * Fail-closed ROI mechanism skip-filter entrypoint.
 * Research-only: require complete official trifecta settlement coverage before
 * the internal exclusion-effect analyzer can emit payout-ROI-based verdicts.
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

const OUT_MD = "reports/roi-mechanism-skip-filters.md";
const OUT_JSON = "reports/roi-mechanism-skip-filters.json";
const OPAQUE_DB_SOURCE = "primary research database";
const internalPath = fileURLToPath(new URL("./analyze-roi-mechanism-skip-filters-internal.ts", import.meta.url));
const internalUrl = pathToFileURL(internalPath).href;
const tsxLoader = import.meta.resolve("tsx");

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[roi-mechanism-skip-filter] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function atomicPublish(path: string, content: string, tempErrorCode: string, destinationErrorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
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

function redactDbProvenance(content: string, dbPath: string): string {
  const redacted = content.split(dbPath).join(OPAQUE_DB_SOURCE);
  if (redacted.includes(dbPath)) {
    throw new Error("ROI_MECHANISM_SKIP_FILTER_PRIVATE_DB_PATH_REMAINS");
  }
  return redacted;
}

const preflight = run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-mechanism-skip-filter] FAIL CLOSED: settlement completeness preflight did not pass; exclusion verdicts were not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_MECHANISM_SKIP_FILTER_DB_HANDOFF_IDENTITY_INVALID",
);

for (const path of [OUT_MD, OUT_JSON]) {
  if (existsSync(path)) {
    assertCanonicalSingleLinkRegularFile(
      path,
      "ROI_MECHANISM_SKIP_FILTER_PREEXISTING_REPORT_IDENTITY_INVALID",
    );
  }
}

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-skip-filter-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });

  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "ROI_MECHANISM_SKIP_FILTER_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", `await import(${JSON.stringify(internalUrl)})`],
    {
      cwd: workspace,
      env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (analysis.error || analysis.status !== 0) {
    throw new Error("ROI_MECHANISM_SKIP_FILTER_INTERNAL_FAILED");
  }

  const stagedMd = join(workspace, OUT_MD);
  const stagedJson = join(workspace, OUT_JSON);
  if (!existsSync(stagedMd)) throw new Error("ROI_MECHANISM_SKIP_FILTER_MD_OUTPUT_MISSING");
  if (!existsSync(stagedJson)) throw new Error("ROI_MECHANISM_SKIP_FILTER_JSON_OUTPUT_MISSING");

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    stagedMd,
    "ROI_MECHANISM_SKIP_FILTER_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    stagedJson,
    "ROI_MECHANISM_SKIP_FILTER_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = redactDbProvenance(readFileSync(verifiedMdPath, "utf-8"), launchDbPath);
  const json = redactDbProvenance(readFileSync(verifiedJsonPath, "utf-8"), launchDbPath);

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "ROI_MECHANISM_SKIP_FILTER_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_MECHANISM_SKIP_FILTER_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ROI_MECHANISM_SKIP_FILTER_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_MECHANISM_SKIP_FILTER_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[roi-mechanism-skip-filter] PASS: payout completeness preflight passed before isolated analysis publication");
