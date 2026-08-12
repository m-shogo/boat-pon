import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export const RESEARCH_RETAINED_OUTPUT_INVENTORY_VERSION =
  "research-retained-output-inventory-v1" as const;

const RETAINED_ROOT = "reports/automation/retained-outputs";
const MAX_RETAINED_FILE_BYTES = 2_097_152;
const RETAINED_READ_CHUNK_BYTES = 64 * 1024;
const RUN_ID_RE = /^[0-9]+$/u;
const RETAINED_FILE_RE = /^([0-9a-f]{64})-((?!\.{1,2}$)[0-9A-Za-z._-]{1,160})$/u;

export type ResearchRetainedOutputInventoryEntry = {
  relativePath: string;
  runId: string | null;
  expectedContentDigest: string | null;
  contentDigest: string | null;
  bytes: number | null;
  valid: boolean;
  issues: string[];
};

export type ResearchRetainedOutputInventory = {
  inventoryVersion: typeof RESEARCH_RETAINED_OUTPUT_INVENTORY_VERSION;
  retainedRoot: typeof RETAINED_ROOT;
  rootPresent: boolean;
  fileCount: number;
  totalBytes: number;
  validFileCount: number;
  invalidFileCount: number;
  entries: ResearchRetainedOutputInventoryEntry[];
};

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveInside(repoRoot: string, relativePath: string): string {
  const root = resolve(repoRoot);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("RETAINED_INVENTORY_PATH_ESCAPES_ROOT");
  }
  return target;
}

function lstatIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function hasSafeParentPath(repoRoot: string, absolutePath: string): boolean {
  const root = resolve(repoRoot);
  let current = dirname(absolutePath);
  while (current !== root) {
    if (!current.startsWith(`${root}${sep}`)) return false;
    const stat = lstatIfPresent(current);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) return false;
    const next = dirname(current);
    if (next === current) return false;
    current = next;
  }
  return true;
}

function invalidEntry(input: {
  relativePath: string;
  runId?: string | null;
  expectedContentDigest?: string | null;
  bytes?: number | null;
  issues: string[];
}): ResearchRetainedOutputInventoryEntry {
  return {
    relativePath: input.relativePath,
    runId: input.runId ?? null,
    expectedContentDigest: input.expectedContentDigest ?? null,
    contentDigest: null,
    bytes: input.bytes ?? null,
    valid: false,
    issues: input.issues,
  };
}

function readValidatedRetainedFile(path: string, expectedStat: Stats): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile()
      || stat.nlink !== 1
      || stat.dev !== expectedStat.dev
      || stat.ino !== expectedStat.ino
      || stat.size !== expectedStat.size
      || stat.size <= 0
      || stat.size > MAX_RETAINED_FILE_BYTES
    ) {
      return null;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithSentinel = expectedStat.size - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(RETAINED_READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > expectedStat.size || totalBytes > MAX_RETAINED_FILE_BYTES) return null;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (totalBytes !== expectedStat.size) return null;
    return Buffer.concat(chunks, totalBytes);
  } finally {
    closeSync(fd);
  }
}

export function inventoryResearchRetainedOutputs(input: {
  repoRoot: string;
}): ResearchRetainedOutputInventory {
  const rootPath = resolveInside(input.repoRoot, RETAINED_ROOT);
  if (!hasSafeParentPath(input.repoRoot, rootPath)) {
    return {
      inventoryVersion: RESEARCH_RETAINED_OUTPUT_INVENTORY_VERSION,
      retainedRoot: RETAINED_ROOT,
      rootPresent: true,
      fileCount: 0,
      totalBytes: 0,
      validFileCount: 0,
      invalidFileCount: 1,
      entries: [invalidEntry({
        relativePath: RETAINED_ROOT,
        issues: ["RETAINED_INVENTORY_ROOT_PARENT_INVALID"],
      })],
    };
  }
  const rootStat = lstatIfPresent(rootPath);
  if (!rootStat) {
    return {
      inventoryVersion: RESEARCH_RETAINED_OUTPUT_INVENTORY_VERSION,
      retainedRoot: RETAINED_ROOT,
      rootPresent: false,
      fileCount: 0,
      totalBytes: 0,
      validFileCount: 0,
      invalidFileCount: 0,
      entries: [],
    };
  }

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    const entry = invalidEntry({
      relativePath: RETAINED_ROOT,
      issues: ["RETAINED_INVENTORY_ROOT_INVALID"],
    });
    return {
      inventoryVersion: RESEARCH_RETAINED_OUTPUT_INVENTORY_VERSION,
      retainedRoot: RETAINED_ROOT,
      rootPresent: true,
      fileCount: 0,
      totalBytes: 0,
      validFileCount: 0,
      invalidFileCount: 1,
      entries: [entry],
    };
  }

  const entries: ResearchRetainedOutputInventoryEntry[] = [];
  let fileCount = 0;
  let totalBytes = 0;

  for (const runDirent of readdirSync(rootPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const runRelativePath = `${RETAINED_ROOT}/${runDirent.name}`;
    const runPath = resolveInside(input.repoRoot, runRelativePath);
    const runStat = lstatSync(runPath);
    if (!RUN_ID_RE.test(runDirent.name) || runDirent.isSymbolicLink() || !runStat.isDirectory()) {
      if (runStat.isFile() || runStat.isSymbolicLink()) {
        fileCount += 1;
        if (runStat.isFile()) totalBytes += runStat.size;
      }
      entries.push(invalidEntry({
        relativePath: runRelativePath,
        runId: RUN_ID_RE.test(runDirent.name) ? runDirent.name : null,
        bytes: runStat.isFile() ? runStat.size : null,
        issues: ["RETAINED_INVENTORY_RUN_DIRECTORY_INVALID"],
      }));
      continue;
    }

    for (const fileDirent of readdirSync(runPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = `${runRelativePath}/${fileDirent.name}`;
      const absolutePath = resolveInside(input.repoRoot, relativePath);
      const stat = lstatSync(absolutePath);
      fileCount += 1;
      if (stat.isFile()) totalBytes += stat.size;

      const match = fileDirent.name.match(RETAINED_FILE_RE);
      const expectedContentDigest = match?.[1] ?? null;
      const issues: string[] = [];
      if (fileDirent.isSymbolicLink() || !stat.isFile()) issues.push("RETAINED_INVENTORY_FILE_TYPE_INVALID");
      if (stat.isFile() && stat.nlink !== 1) issues.push("RETAINED_INVENTORY_FILE_LINK_COUNT_INVALID");
      if (!match) issues.push("RETAINED_INVENTORY_FILENAME_INVALID");
      if (stat.isFile() && (stat.size <= 0 || stat.size > MAX_RETAINED_FILE_BYTES)) {
        issues.push("RETAINED_INVENTORY_FILE_SIZE_INVALID");
      }
      if (issues.length > 0) {
        entries.push(invalidEntry({
          relativePath,
          runId: runDirent.name,
          expectedContentDigest,
          bytes: stat.isFile() ? stat.size : null,
          issues,
        }));
        continue;
      }

      const content = readValidatedRetainedFile(absolutePath, stat);
      if (content === null) {
        entries.push(invalidEntry({
          relativePath,
          runId: runDirent.name,
          expectedContentDigest,
          bytes: stat.size,
          issues: ["RETAINED_INVENTORY_FILE_CHANGED_DURING_READ"],
        }));
        continue;
      }
      const contentDigest = sha256(content);
      if (contentDigest !== expectedContentDigest) {
        entries.push({
          relativePath,
          runId: runDirent.name,
          expectedContentDigest,
          contentDigest,
          bytes: stat.size,
          valid: false,
          issues: ["RETAINED_INVENTORY_CONTENT_DIGEST_MISMATCH"],
        });
        continue;
      }
      entries.push({
        relativePath,
        runId: runDirent.name,
        expectedContentDigest,
        contentDigest,
        bytes: stat.size,
        valid: true,
        issues: [],
      });
    }
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const validFileCount = entries.filter((entry) => entry.valid).length;
  const invalidFileCount = entries.filter((entry) => !entry.valid).length;
  return {
    inventoryVersion: RESEARCH_RETAINED_OUTPUT_INVENTORY_VERSION,
    retainedRoot: RETAINED_ROOT,
    rootPresent: true,
    fileCount,
    totalBytes,
    validFileCount,
    invalidFileCount,
    entries,
  };
}
