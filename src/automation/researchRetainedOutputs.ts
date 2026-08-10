import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

const RETAINED_ROOT = "reports/automation/retained-outputs";
const MAX_RETAINED_SOURCE_BYTES = 2_097_152;
const MAX_EXECUTOR_OUTPUT_PATHS = 64;
const MAX_RETAINED_TOTAL_BYTES = 8_388_608;
const MUTABLE_OUTPUT_ROOTS = [
  "reports/n2/",
  "reports/automation/",
  "automation/control/",
] as const;
const PASSTHROUGH_IMMUTABLE_ROOTS = ["research/registries/"] as const;
const RUN_ID_RE = /^[0-9A-Za-z._-]+$/u;
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
  if (relativePath.split("/").some((part) => part === "..")) {
    throw new Error("RETAINED_OUTPUT_PATH_UNSAFE");
  }
  const root = resolve(repoRoot);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("RETAINED_OUTPUT_PATH_ESCAPES_ROOT");
  }
  return target;
}

function sourceClass(relativePath: string): "MUTABLE" | "IMMUTABLE" {
  if (relativePath.startsWith(`${RETAINED_ROOT}/`)) return "IMMUTABLE";
  if (PASSTHROUGH_IMMUTABLE_ROOTS.some((root) => relativePath.startsWith(root))) return "IMMUTABLE";
  if (MUTABLE_OUTPUT_ROOTS.some((root) => relativePath.startsWith(root))) return "MUTABLE";
  throw new Error(`RETAINED_OUTPUT_SOURCE_NOT_ALLOWED:${relativePath}`);
}

function safeBasename(relativePath: string): string {
  const value = basename(relativePath);
  if (!value || value === "." || value === "..") throw new Error("RETAINED_OUTPUT_BASENAME_INVALID");
  return value.replace(/[^0-9A-Za-z._-]/gu, "_").slice(0, 160);
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
  if (!existsSync(sourceAbsolute)) throw new Error(`RETAINED_OUTPUT_SOURCE_MISSING:${input.sourceRelativePath}`);
  const stat = lstatSync(sourceAbsolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`RETAINED_OUTPUT_SOURCE_FILE_TYPE_INVALID:${input.sourceRelativePath}`);
  }
  if (stat.size <= 0 || stat.size > MAX_RETAINED_SOURCE_BYTES) {
    throw new Error(`RETAINED_OUTPUT_SOURCE_SIZE_INVALID:${input.sourceRelativePath}`);
  }

  const content = readFileSync(sourceAbsolute);
  validateRetainedJsonSource({
    sourceRelativePath: input.sourceRelativePath,
    content,
    historyOutputDigest: input.historyOutputDigest,
  });
  const contentDigest = sha256Buffer(content);
  if (!SHA256_RE.test(contentDigest)) throw new Error("RETAINED_OUTPUT_CONTENT_DIGEST_INVALID");
  const retainedRelativePath = `${RETAINED_ROOT}/${input.runId}/${contentDigest}-${safeBasename(input.sourceRelativePath)}`;
  const retainedAbsolutePath = resolveInside(input.repoRoot, retainedRelativePath);

  let changed = true;
  if (existsSync(retainedAbsolutePath)) {
    const existingStat = lstatSync(retainedAbsolutePath);
    if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
      throw new Error(`RETAINED_OUTPUT_EXISTING_FILE_TYPE_INVALID:${retainedRelativePath}`);
    }
    const existing = readFileSync(retainedAbsolutePath);
    if (sha256Buffer(existing) !== contentDigest || !existing.equals(content)) {
      throw new Error(`RETAINED_OUTPUT_EXISTING_CONTENT_MISMATCH:${retainedRelativePath}`);
    }
    changed = false;
  }

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

function materializePreparedOutputs(prepared: PreparedRetainedOutput[]): void {
  const created: string[] = [];
  try {
    for (const item of prepared) {
      if (!item.changed) continue;
      mkdirSync(dirname(item.retainedAbsolutePath), { recursive: true });
      const tempPath = `${item.retainedAbsolutePath}.${randomUUID()}.tmp`;
      try {
        writeFileSync(tempPath, item.content, { mode: 0o644 });
        const tempReadback = readFileSync(tempPath);
        if (sha256Buffer(tempReadback) !== item.contentDigest || !tempReadback.equals(item.content)) {
          throw new Error(`RETAINED_OUTPUT_TEMP_READBACK_MISMATCH:${item.retainedRelativePath}`);
        }
        try {
          // Hard-link publication is atomic and never replaces an immutable retained target.
          // A concurrent creator is a fail-closed race, not permission to overwrite evidence.
          linkSync(tempPath, item.retainedAbsolutePath);
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new Error(`RETAINED_OUTPUT_TARGET_RACE:${item.retainedRelativePath}`);
          }
          throw error;
        }
        created.push(item.retainedAbsolutePath);
        chmodSync(item.retainedAbsolutePath, 0o644);
        const readback = readFileSync(item.retainedAbsolutePath);
        if (sha256Buffer(readback) !== item.contentDigest || !readback.equals(item.content)) {
          throw new Error(`RETAINED_OUTPUT_READBACK_MISMATCH:${item.retainedRelativePath}`);
        }
      } finally {
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
  materializePreparedOutputs(prepared);

  return {
    historyOutputs,
    retainedOutputs: prepared.map(({ retainedAbsolutePath: _absolute, content: _content, ...value }) => value),
  };
}
