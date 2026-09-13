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
import { fileURLToPath } from "node:url";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const auditPath = fileURLToPath(new URL("./assert-roi-all-feature-settlement-integrity.ts", import.meta.url));
const analyzerPath = fileURLToPath(new URL("./search-roi-all-features-lite.ts", import.meta.url));
const OUTPUTS = [
  { staged: "reports/roi-all-feature-search.md", destination: "reports/roi-all-feature-search.md", code: "MD" },
  { staged: "reports/roi-all-feature-search.json", destination: "reports/roi-all-feature-search.json", code: "JSON" },
  { staged: "reports/roi-all-feature-search.csv", destination: "reports/roi-all-feature-search.csv", code: "CSV" },
] as const;

function run(script: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function assertCanonicalDirectory(path: string, code: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(code);
  return resolvedPath;
}

function verifyExistingDestinations(): void {
  for (const output of OUTPUTS) {
    if (!existsSync(output.destination)) continue;
    assertCanonicalSingleLinkRegularFile(
      output.destination,
      `ROI_ALL_FEATURE_${output.code}_PREPUBLISH_DESTINATION_IDENTITY_INVALID`,
    );
  }
}

function atomicPublish(path: string, content: string, code: string): void {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, `ROI_ALL_FEATURE_${code}_PUBLISH_PARENT_IDENTITY_INVALID`);
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
      `ROI_ALL_FEATURE_${code}_PUBLISH_TEMP_IDENTITY_INVALID`,
    );
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(
        path,
        `ROI_ALL_FEATURE_${code}_PUBLISH_DESTINATION_IDENTITY_INVALID`,
      );
    }
    assertCanonicalDirectory(parentPath, `ROI_ALL_FEATURE_${code}_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID`);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const auditedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_ALL_FEATURE_PREFLIGHT_DB_IDENTITY_INVALID",
);
run(auditPath, { env: { ...process.env, BOAT_PON_DB_PATH: auditedDbPath } });

// The settlement gate and analyzer remain separate read-only processes. Reverify
// the database immediately before the analyzer launch so a path swap cannot
// bypass the preflight, and keep raw report writes outside canonical reports/.
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_ALL_FEATURE_ANALYZER_DB_IDENTITY_INVALID",
);
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-all-feature-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const childDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "ROI_ALL_FEATURE_DB_CHILD_HANDOFF_IDENTITY_INVALID",
  );
  run(analyzerPath, {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: childDbPath },
  });

  // Validate every staged artifact before canonical publication begins. Then
  // revalidate at the read and handoff boundaries so a staged path swap cannot
  // produce a partial or unverified canonical report set.
  const stagedOutputs = OUTPUTS.map((output) => {
    const stagedPath = join(workspace, output.staged);
    const verifiedStagedPath = assertCanonicalSingleLinkRegularFile(
      stagedPath,
      `ROI_ALL_FEATURE_${output.code}_STAGED_OUTPUT_IDENTITY_INVALID`,
    );
    return { output, verifiedStagedPath };
  });
  const preparedOutputs = stagedOutputs.map(({ output, verifiedStagedPath }) => {
    const readPath = assertCanonicalSingleLinkRegularFile(
      verifiedStagedPath,
      `ROI_ALL_FEATURE_${output.code}_STAGED_READ_IDENTITY_INVALID`,
    );
    const content = readFileSync(readPath, "utf8");
    assertCanonicalSingleLinkRegularFile(
      readPath,
      `ROI_ALL_FEATURE_${output.code}_STAGED_HANDOFF_IDENTITY_INVALID`,
    );
    return { output, content };
  });

  // Validate the complete canonical destination set before the first rename so
  // a bad sibling path cannot leave only part of the MD/JSON/CSV set updated.
  mkdirSync("reports", { recursive: true });
  assertCanonicalDirectory("reports", "ROI_ALL_FEATURE_REPORTS_DIRECTORY_IDENTITY_INVALID");
  verifyExistingDestinations();
  for (const { output, content } of preparedOutputs) {
    atomicPublish(output.destination, content, output.code);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
