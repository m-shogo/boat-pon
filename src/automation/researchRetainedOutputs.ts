import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

const RETAINED_ROOT = "reports/automation/retained-outputs";
const MAX_RETAINED_SOURCE_BYTES = 2_097_152;
const MAX_EXECUTOR_OUTPUT_PATHS = 64;
const MAX_RETAINED_TOTAL_BYTES = 8_388_608;
const RETAINED_READ_CHUNK_BYTES = 64 * 1024;
const MUTABLE_OUTPUT_ROOTS = [
  "reports/n2/",
  "reports/automation/",
  "automation/control/",
] as const;
const PASSTHROUGH_IMMUTABLE_ROOTS = ["research/registries/"] as const;
const RUN_ID_RE = /^(?!\.{1,2}$)[0-9A-Za-z._-]+$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export type RetainedExecutorOutput = {
  sourceRelativePath: string;
  retainedRelativePath: string;
  contentDigest: string;
  bytes: number;
  changed: boolean;
};

export type RetainedExecutorOutputsResult = {
  historyOutputs: string[];
  retainedOutputs: RetainedExecutorOutput[];
};

type PreparedRetainedOutput = RetainedExecutorOutput & {
  retainedAbsolutePath: string;
  content: Buffer;
};

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveInside(repoRoot: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("RETAINED_OUTPUT_PATH_UNSAFE");
  }
  if (relativePath.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("RETAINED_OUTPUT_PATH_UNSAFE");
  }
  const root = resolve(repoRoot);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("RETAINED_OUTPUT_PATH_ESCAPES_ROOT");
  }
  return target;
}

function assertSourceParentCanonicalInsideRepo(repoRoot: string, sourceAbsolute: string, sourceRelativePath: string): void {
  const lexicalRoot = resolve(repoRoot);
  const lexicalParent = dirname(resolve(sourceAbsolute));
  const relativeParent = relative(lexicalRoot, lexicalParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || relativeParent.startsWith("/")) {
    throw new Error(`RETAINED_OUTPUT_SOURCE_PATH_ESCAPES_ROOT:${sourceRelativePath}`);
  }
  let canonicalRoot: string;
  let canonicalParent: string;
  try {
    canonicalRoot = realpathSync.native(lexicalRoot);
    canonicalParent = realpathSync.native(lexicalParent);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`RETAINED_OUTPUT_SOURCE_MISSING:${sourceRelativePath}`);
    }
    throw error;
  }
  const expectedCanonicalParent = resolve(canonicalRoot, relativeParent);
  if (canonicalParent !== expectedCanonicalParent) {
    throw new Error(`RETAINED_OUTPUT_SOURCE_PATH_ALIAS:${sourceRelativePath}`);
  }
}

function assertTargetParentCanonicalInsideRepo(
  repoRoot: string,
  retainedAbsolutePath: string,
  retainedRelativePath: string,
): boolean {
  const lexicalRoot = resolve(repoRoot);
  const lexicalParent = dirname(resolve(retainedAbsolutePath));
  const relativeParent = relative(lexicalRoot, lexicalParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || relativeParent.startsWith("/")) {
    throw new Error(`RETAINED_OUTPUT_TARGET_PATH_ESCAPES_ROOT:${retainedRelativePath}`);
  }

  const canonicalRoot = realpathSync.native(lexicalRoot);
  let probe = lexicalParent;
  while (true) {
    try {
      const canonicalProbe = realpathSync.native(probe);
      const relativeProbe = relative(lexicalRoot, probe);
      if (relativeProbe === ".." || relativeProbe.startsWith(`..${sep}`) || relativeProbe.startsWith("/")) {
        throw new Error(`RETAINED_OUTPUT_TARGET_PATH_ESCAPES_ROOT:${retainedRelativePath}`);
      }
      if (canonicalProbe !== resolve(canonicalRoot, relativeProbe)) {
        throw new Error(`RETAINED_OUTPUT_TARGET_PATH_ALIAS:${retainedRelativePath}`);
      }
      return probe === lexicalParent;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new Error(`RETAINED_OUTPUT_TARGET_PATH_ALIAS:${retainedRelativePath}`);
      probe = parent;
    }
  }
}

function sourceClass(relativePath: string): "MUTABLE" | "IMMUTABLE" {
  if (relativePath.startsWith(`${RETAINED_ROOT}/`)) return "IMMUTABLE";
  if (PASSTHROUGH_IMMUTABLE_ROOTS.some((root) => relativePath.startsWith(root))) return "IMMUTABLE";
  if (MUTABLE_OUTPUT_ROOTS.some((root) => relativePath.startsWith(root))) return "MUTABLE";
  throw new Error(`RETAINED_OUTPUT_SOURCE_NOT_ALLOWED:${relativePath}`);
}

function validateImmutableOutputReference(repoRoot: string, sourceRelativePath: string): void {
  const sourceAbsolute = resolveInside(repoRoot, sourceRelativePath);
  assertSourceParentCanonicalInsideRepo(repoRoot, sourceAbsolute, sourceRelativePath);
  let fd: number | null = null;
  try {
    fd = openSync(sourceAbsolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`RETAINED_OUTPUT_IMMUTABLE_FILE_TYPE_INVALID:${sourceRelativePath}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`RETAINED_OUTPUT_IMMUTABLE_MISSING:${sourceRelativePath}`);
    }
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error(`RETAINED_OUTPUT_IMMUTABLE_FILE_TYPE_INVALID:${sourceRelativePath}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function safeBasename(relativePath: string): string {
  const value = basename(relativePath);
  if (!value || value === "." || value === "..") throw new Error("RETAINED_OUTPUT_BASENAME_INVALID");
  return value.replace(/[^0-9A-Za-z._-]/gu, "_").slice(0, 160);
}

function readRetainedSourceBounded(sourceAbsolute: string, sourceRelativePath: string): Buffer {
  let fd: number | null = null;
  try {
    fd = openSync(sourceAbsolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`RETAINED_OUTPUT_SOURCE_FILE_TYPE_INVALID:${sourceRelativePath}`);
    }
    if (stat.size <= 0 || stat.size > MAX_RETAINED_SOURCE_BYTES) {
      throw new Error(`RETAINED_OUTPUT_SOURCE_SIZE_INVALID:${sourceRelativePath}`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithSentinel = MAX_RETAINED_SOURCE_BYTES - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(RETAINED_READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_RETAINED_SOURCE_BYTES) {
        throw new Error(`RETAINED_OUTPUT_SOURCE_SIZE_INVALID:${sourceRelativePath}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const postReadStat = fstatSync(fd);
    if (postReadStat.size !== stat.size || totalBytes !== stat.size) {
      throw new Error(`RETAINED_OUTPUT_SOURCE_CHANGED_DURING_READ:${sourceRelativePath}`);
    }
    if (totalBytes <= 0) throw new Error(`RETAINED_OUTPUT_SOURCE_SIZE_INVALID:${sourceRelativePath}`);
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`RETAINED_OUTPUT_SOURCE_MISSING:${sourceRelativePath}`);
    }
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error(`RETAINED_OUTPUT_SOURCE_FILE_TYPE_INVALID:${sourceRelativePath}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function existingRetainedTargetMatches(input: {
  retainedAbsolutePath: string;
  retainedRelativePath: string;
  expectedContent: Buffer;
  expectedDigest: string;
}): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(input.retainedAbsolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`RETAINED_OUTPUT_EXISTING_FILE_TYPE_INVALID:${input.retainedRelativePath}`);
    }
    if (stat.size !== input.expectedContent.length) {
      throw new Error(`RETAINED_OUTPUT_EXISTING_CONTENT_MISMATCH:${input.retainedRelativePath}`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = input.expectedContent.length;
    while (true) {
      const remainingWithSentinel = maxBytes - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(RETAINED_READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new Error(`RETAINED_OUTPUT_EXISTING_CONTENT_MISMATCH:${input.retainedRelativePath}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const existing = Buffer.concat(chunks, totalBytes);
    if (sha256Buffer(existing) !== input.expectedDigest || !existing.equals(input.expectedContent)) {
      throw new Error(`RETAINED_OUTPUT_EXISTING_CONTENT_MISMATCH:${input.retainedRelativePath}`);
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error(`RETAINED_OUTPUT_EXISTING_FILE_TYPE_INVALID:${input.retainedRelativePath}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function validateRetainedJsonSource(input: {
  sourceRelativePath: string;
  content: Buffer;
  historyOutputDigest: string;
}): void {
  if (!input.sourceRelativePath.endsWith(".json")) return;
  let decoded: string;
  try {
    decoded = STRICT_UTF8_DECODER.decode(input.content);
  } catch {
    throw new Error(`RETAINED_OUTPUT_JSON_INVALID_UTF8:${input.sourceRelativePath}`);
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(decoded) as unknown;
    if (typeof value !== "object" || value == null || Array.isArray(value)) throw new Error("not object");
    parsed = value as Record<string, unknown>;
  } catch {
    throw new Error(`RETAINED_OUTPUT_JSON_INVALID:${input.sourceRelativePath}`);
  }
  const embeddedDigest = typeof parsed.outputDigest === "string" && SHA256_RE.test(parsed.outputDigest)
    ? parsed.outputDigest
    : null;
  if (embeddedDigest != null && embeddedDigest !== input.historyOutputDigest) {
    throw new Error(`RETAINED_OUTPUT_HISTORY_DIGEST_MISMATCH:${input.sourceRelativePath}`);
  }
}

function prepareMutableOutput(input: {
  repoRoot: string;
  runId: string;
  sourceRelativePath: string;
  historyOutputDigest: string;
}): PreparedRetainedOutput {
  const sourceAbsolute = resolveInside(input.repoRoot, input.sourceRelativePath);
  assertSourceParentCanonicalInsideRepo(input.repoRoot, sourceAbsolute, input.sourceRelativePath);
  const content = readRetainedSourceBounded(sourceAbsolute, input.sourceRelativePath);
  validateRetainedJsonSource({
    sourceRelativePath: input.sourceRelativePath,
    content,
    historyOutputDigest: input.historyOutputDigest,
  });
  const contentDigest = sha256Buffer(content);
  if (!SHA256_RE.test(contentDigest)) throw new Error("RETAINED_OUTPUT_CONTENT_DIGEST_INVALID");
  const retainedRelativePath = `${RETAINED_ROOT}/${input.runId}/${contentDigest}-${safeBasename(input.sourceRelativePath)}`;
  const retainedAbsolutePath = resolveInside(input.repoRoot, retainedRelativePath);
  const targetParentExists = assertTargetParentCanonicalInsideRepo(
    input.repoRoot,
    retainedAbsolutePath,
    retainedRelativePath,
  );

  const changed = !targetParentExists || !existingRetainedTargetMatches({
    retainedAbsolutePath,
    retainedRelativePath,
    expectedContent: content,
    expectedDigest: contentDigest,
  });

  return {
    sourceRelativePath: input.sourceRelativePath,
    retainedRelativePath,
    retainedAbsolutePath,
    contentDigest,
    bytes: content.length,
    changed,
    content,
  };
}

function verifyPublishedRetainedTarget(item: PreparedRetainedOutput): void {
  let fd: number | null = null;
  try {
    fd = openSync(item.retainedAbsolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 2) {
      throw new Error(`RETAINED_OUTPUT_READBACK_FILE_TYPE_INVALID:${item.retainedRelativePath}`);
    }
    if (stat.size !== item.content.length) {
      throw new Error(`RETAINED_OUTPUT_READBACK_MISMATCH:${item.retainedRelativePath}`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithSentinel = item.content.length - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(RETAINED_READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > item.content.length) {
        throw new Error(`RETAINED_OUTPUT_READBACK_MISMATCH:${item.retainedRelativePath}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const readback = Buffer.concat(chunks, totalBytes);
    if (sha256Buffer(readback) !== item.contentDigest || !readback.equals(item.content)) {
      throw new Error(`RETAINED_OUTPUT_READBACK_MISMATCH:${item.retainedRelativePath}`);
    }
    fchmodSync(fd, 0o644);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ELOOP")) {
      throw new Error(`RETAINED_OUTPUT_READBACK_FILE_TYPE_INVALID:${item.retainedRelativePath}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function materializePreparedOutputs(repoRoot: string, prepared: PreparedRetainedOutput[]): void {
  const created: string[] = [];
  try {
    for (const item of prepared) {
      if (!item.changed) continue;
      assertTargetParentCanonicalInsideRepo(repoRoot, item.retainedAbsolutePath, item.retainedRelativePath);
      mkdirSync(dirname(item.retainedAbsolutePath), { recursive: true });
      if (!assertTargetParentCanonicalInsideRepo(repoRoot, item.retainedAbsolutePath, item.retainedRelativePath)) {
        throw new Error(`RETAINED_OUTPUT_TARGET_PARENT_MISSING:${item.retainedRelativePath}`);
      }
      const tempPath = `${item.retainedAbsolutePath}.${randomUUID()}.tmp`;
      let tempFd: number | null = null;
      try {
        try {
          tempFd = openSync(
            tempPath,
            constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
            0o644,
          );
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new Error(`RETAINED_OUTPUT_TEMP_RACE:${item.retainedRelativePath}`);
          }
          throw error;
        }

        let totalWritten = 0;
        while (totalWritten < item.content.length) {
          const bytesWritten = writeSync(
            tempFd,
            item.content,
            totalWritten,
            item.content.length - totalWritten,
            totalWritten,
          );
          if (bytesWritten <= 0) throw new Error(`RETAINED_OUTPUT_TEMP_WRITE_FAILED:${item.retainedRelativePath}`);
          totalWritten += bytesWritten;
        }
        const tempStat = fstatSync(tempFd);
        if (!tempStat.isFile() || tempStat.nlink !== 1 || tempStat.size !== item.content.length) {
          throw new Error(`RETAINED_OUTPUT_TEMP_FILE_TYPE_INVALID:${item.retainedRelativePath}`);
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        while (totalBytes < item.content.length) {
          const chunk = Buffer.allocUnsafe(Math.min(RETAINED_READ_CHUNK_BYTES, item.content.length - totalBytes));
          const bytesRead = readSync(tempFd, chunk, 0, chunk.length, totalBytes);
          if (bytesRead === 0) break;
          totalBytes += bytesRead;
          chunks.push(chunk.subarray(0, bytesRead));
        }
        const tempReadback = Buffer.concat(chunks, totalBytes);
        if (sha256Buffer(tempReadback) !== item.contentDigest || !tempReadback.equals(item.content)) {
          throw new Error(`RETAINED_OUTPUT_TEMP_READBACK_MISMATCH:${item.retainedRelativePath}`);
        }
        try {
          // Hard-link publication is atomic and never replaces an immutable retained target.
          linkSync(tempPath, item.retainedAbsolutePath);
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            const matchesExisting = existingRetainedTargetMatches({
              retainedAbsolutePath: item.retainedAbsolutePath,
              retainedRelativePath: item.retainedRelativePath,
              expectedContent: item.content,
              expectedDigest: item.contentDigest,
            });
            if (!matchesExisting) {
              throw new Error(`RETAINED_OUTPUT_TARGET_RACE:${item.retainedRelativePath}`);
            }
            continue;
          }
          throw error;
        }
        created.push(item.retainedAbsolutePath);
        verifyPublishedRetainedTarget(item);
      } finally {
        if (tempFd !== null) closeSync(tempFd);
        if (existsSync(tempPath)) unlinkSync(tempPath);
      }
    }
  } catch (error) {
    for (const path of created.reverse()) {
      try { unlinkSync(path); } catch { /* best-effort rollback of files created by this call only */ }
    }
    throw error;
  }
}

export function retainExecutorOutputs(input: {
  repoRoot: string;
  runId: string;
  outputPaths: string[];
  historyOutputDigest: string;
}): RetainedExecutorOutputsResult {
  if (!RUN_ID_RE.test(input.runId)) throw new Error("RETAINED_OUTPUT_RUN_ID_INVALID");
  if (!SHA256_RE.test(input.historyOutputDigest)) throw new Error("RETAINED_OUTPUT_HISTORY_DIGEST_INVALID");

  const uniqueOutputPaths = [...new Set(input.outputPaths)];
  if (uniqueOutputPaths.length > MAX_EXECUTOR_OUTPUT_PATHS) {
    throw new Error(`RETAINED_OUTPUT_COUNT_EXCEEDED:${uniqueOutputPaths.length}>${MAX_EXECUTOR_OUTPUT_PATHS}`);
  }

  // Phase 1: classify and validate every source before creating any retained file.
  // This prevents a later invalid source from leaving an orphan copy of an earlier source.
  const historyOutputs: string[] = [];
  const historyOutputSet = new Set<string>();
  const preparedByRetainedPath = new Map<string, PreparedRetainedOutput>();
  for (const outputPath of uniqueOutputPaths) {
    const classification = sourceClass(outputPath);
    if (classification === "IMMUTABLE") {
      validateImmutableOutputReference(input.repoRoot, outputPath);
      if (!historyOutputSet.has(outputPath)) {
        historyOutputSet.add(outputPath);
        historyOutputs.push(outputPath);
      }
      continue;
    }

    const prepared = prepareMutableOutput({
      repoRoot: input.repoRoot,
      runId: input.runId,
      sourceRelativePath: outputPath,
      historyOutputDigest: input.historyOutputDigest,
    });
    const prior = preparedByRetainedPath.get(prepared.retainedRelativePath);
    if (prior) {
      if (prior.contentDigest !== prepared.contentDigest || !prior.content.equals(prepared.content)) {
        throw new Error(`RETAINED_OUTPUT_TARGET_COLLISION:${prepared.retainedRelativePath}`);
      }
    } else {
      preparedByRetainedPath.set(prepared.retainedRelativePath, prepared);
    }
    if (!historyOutputSet.has(prepared.retainedRelativePath)) {
      historyOutputSet.add(prepared.retainedRelativePath);
      historyOutputs.push(prepared.retainedRelativePath);
    }
  }

  const prepared = [...preparedByRetainedPath.values()];
  const retainedTotalBytes = prepared.reduce((sum, item) => sum + item.bytes, 0);
  if (retainedTotalBytes > MAX_RETAINED_TOTAL_BYTES) {
    throw new Error(`RETAINED_OUTPUT_TOTAL_BYTES_EXCEEDED:${retainedTotalBytes}>${MAX_RETAINED_TOTAL_BYTES}`);
  }

  // Phase 2: materialize only after every source/target and the aggregate budget have been validated.
  materializePreparedOutputs(input.repoRoot, prepared);

  return {
    historyOutputs,
    retainedOutputs: prepared.map(({ retainedAbsolutePath: _absolute, content: _content, ...value }) => value),
  };
}
