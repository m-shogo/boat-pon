/**
 * audit-all-bet-type-data-feasibility.ts — research-only guarded entrypoint
 *
 * Keeps the Phase N0 feasibility audit isolated from production behavior while
 * validating the research DB identity immediately before the legacy read-only
 * implementation runs. Persisted reports must use opaque DB provenance and are
 * published only after isolated staged outputs have been validated.
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
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const REPORT_JSON = "reports/all-bet-type-data-feasibility.json";
const REPORT_MD = "reports/all-bet-type-data-feasibility.md";
const OPAQUE_DB_SOURCE = "canonical research database";
const internalPath = fileURLToPath(new URL("./audit-all-bet-type-data-feasibility-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function verifyExistingOutput(path: string, errorCode: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, errorCode);
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
    verifyExistingOutput(path, destinationErrorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("ALL_BET_TYPE_FEASIBILITY_RESEARCH_DB_UNAVAILABLE");
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ALL_BET_TYPE_FEASIBILITY_DB_IDENTITY_INVALID",
);

// Reverify immediately before child launch so a path swap cannot bypass the
// successful entrypoint identity check.
const childDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "ALL_BET_TYPE_FEASIBILITY_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-all-bet-type-feasibility-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const result = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    stdio: "inherit",
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: childDbPath },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ALL_BET_TYPE_FEASIBILITY_INTERNAL_AUDIT_FAILED status=${result.status ?? "unknown"}`);
  }

  const stagedJsonPath = join(workspace, REPORT_JSON);
  const stagedMarkdownPath = join(workspace, REPORT_MD);
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    stagedJsonPath,
    "ALL_BET_TYPE_FEASIBILITY_JSON_STAGED_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedMarkdownPath = assertCanonicalSingleLinkRegularFile(
    stagedMarkdownPath,
    "ALL_BET_TYPE_FEASIBILITY_MARKDOWN_STAGED_OUTPUT_IDENTITY_INVALID",
  );

  const jsonReadPath = assertCanonicalSingleLinkRegularFile(
    verifiedJsonPath,
    "ALL_BET_TYPE_FEASIBILITY_JSON_STAGED_READ_IDENTITY_INVALID",
  );
  const parsed = JSON.parse(readFileSync(jsonReadPath, "utf8")) as {
    safety?: { dbPath?: unknown };
  };
  if (!parsed.safety || parsed.safety.dbPath !== childDbPath) {
    throw new Error("ALL_BET_TYPE_FEASIBILITY_DB_PROVENANCE_UNEXPECTED");
  }
  parsed.safety.dbPath = OPAQUE_DB_SOURCE;
  const sanitizedJson = `${JSON.stringify(parsed, null, 2)}\n`;
  if (sanitizedJson.includes(childDbPath)) {
    throw new Error("ALL_BET_TYPE_FEASIBILITY_PRIVATE_DB_PROVENANCE_REMAINED");
  }
  assertCanonicalSingleLinkRegularFile(
    jsonReadPath,
    "ALL_BET_TYPE_FEASIBILITY_JSON_STAGED_HANDOFF_IDENTITY_INVALID",
  );

  const markdownReadPath = assertCanonicalSingleLinkRegularFile(
    verifiedMarkdownPath,
    "ALL_BET_TYPE_FEASIBILITY_MARKDOWN_STAGED_READ_IDENTITY_INVALID",
  );
  const markdown = readFileSync(markdownReadPath, "utf8");
  if (!markdown.includes(childDbPath)) {
    throw new Error("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_DB_PROVENANCE_NOT_FOUND");
  }
  const sanitizedMarkdown = markdown.replaceAll(childDbPath, OPAQUE_DB_SOURCE);
  if (sanitizedMarkdown.includes(childDbPath)) {
    throw new Error("ALL_BET_TYPE_FEASIBILITY_PRIVATE_DB_PROVENANCE_REMAINED");
  }
  assertCanonicalSingleLinkRegularFile(
    markdownReadPath,
    "ALL_BET_TYPE_FEASIBILITY_MARKDOWN_STAGED_HANDOFF_IDENTITY_INVALID",
  );

  // Do not touch canonical report destinations until both staged artifacts have
  // passed identity and provenance validation.
  mkdirSync("reports", { recursive: true });
  atomicPublish(
    REPORT_JSON,
    sanitizedJson,
    "ALL_BET_TYPE_FEASIBILITY_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ALL_BET_TYPE_FEASIBILITY_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    REPORT_MD,
    sanitizedMarkdown,
    "ALL_BET_TYPE_FEASIBILITY_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID",
    "ALL_BET_TYPE_FEASIBILITY_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[all-bet-type-feasibility] PASS: isolated audit output verified and persisted provenance redacted");
