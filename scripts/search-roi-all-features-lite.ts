/**
 * search-roi-all-features-lite.ts — research-only fail-closed entrypoint
 *
 * Keep the all-feature ROI search isolated from canonical reports until all
 * three staged artifacts have passed identity and provenance checks.
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

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-all-feature-search.md";
const OUT_JSON = "reports/roi-all-feature-search.json";
const OUT_CSV = "reports/roi-all-feature-search.csv";
const internalPath = fileURLToPath(new URL("./search-roi-all-features-lite-internal.ts", import.meta.url));
const internalUrl = pathToFileURL(internalPath).href;
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
  verifyExistingOutput(OUT_MD, "ROI_ALL_FEATURE_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  verifyExistingOutput(OUT_JSON, "ROI_ALL_FEATURE_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  verifyExistingOutput(OUT_CSV, "ROI_ALL_FEATURE_CSV_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
}

function atomicPublish(
  targetPath: string,
  content: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const parentPath = dirname(targetPath);
  assertCanonicalDirectory(parentPath, "ROI_ALL_FEATURE_PUBLISH_PARENT_IDENTITY_INVALID");
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
    assertCanonicalDirectory(parentPath, "ROI_ALL_FEATURE_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
    renameSync(verifiedTempPath, targetPath);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

if (!existsSync(DB_PATH)) throw new Error("ROI_ALL_FEATURE_PRIMARY_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_ALL_FEATURE_PRIMARY_DB_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-all-feature-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });

  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "ROI_ALL_FEATURE_DB_CHILD_LAUNCH_IDENTITY_INVALID",
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
    if (analysis.stderr) process.stderr.write(analysis.stderr);
    throw new Error("ROI_ALL_FEATURE_INTERNAL_ANALYSIS_FAILED");
  }

  const stagedMd = join(workspace, OUT_MD);
  const stagedJson = join(workspace, OUT_JSON);
  const stagedCsv = join(workspace, OUT_CSV);
  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    stagedMd,
    "ROI_ALL_FEATURE_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    stagedJson,
    "ROI_ALL_FEATURE_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedCsvPath = assertCanonicalSingleLinkRegularFile(
    stagedCsv,
    "ROI_ALL_FEATURE_CSV_OUTPUT_IDENTITY_INVALID",
  );

  const markdown = readFileSync(verifiedMdPath, "utf-8");
  const json = readFileSync(verifiedJsonPath, "utf-8");
  const csv = readFileSync(verifiedCsvPath, "utf-8");
  JSON.parse(json);
  for (const content of [markdown, json, csv]) {
    if (content.includes(launchDbPath)) {
      throw new Error("ROI_ALL_FEATURE_PRIVATE_DB_PATH_REMAINS");
    }
  }

  mkdirSync("reports", { recursive: true });
  assertCanonicalDirectory("reports", "ROI_ALL_FEATURE_REPORTS_DIRECTORY_IDENTITY_INVALID");
  verifyExistingOutputs();

  atomicPublish(
    OUT_JSON,
    json,
    "ROI_ALL_FEATURE_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_ALL_FEATURE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_CSV,
    csv,
    "ROI_ALL_FEATURE_CSV_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_ALL_FEATURE_CSV_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_MD,
    markdown,
    "ROI_ALL_FEATURE_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_ALL_FEATURE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );

  if (analysis.stdout) process.stdout.write(analysis.stdout);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[search-roi-all-features-lite] PASS: isolated staged artifacts published atomically after complete destination preflight");
