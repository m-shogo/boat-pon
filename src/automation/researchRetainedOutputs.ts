import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

const RETAINED_ROOT = "reports/automation/retained-outputs";
const MAX_RETAINED_SOURCE_BYTES = 2_097_152;
const MUTABLE_OUTPUT_ROOTS = [
  "reports/n2/",
  "reports/automation/",
  "automation/control/",
] as const;
const PASSTHROUGH_IMMUTABLE_ROOTS = ["research/registries/"] as const;
const RUN_ID_RE = /^[0-9A-Za-z._-]+$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

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

function retainOne(input: {
  repoRoot: string;
  runId: string;
  sourceRelativePath: string;
}): RetainedExecutorOutput {
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
  const contentDigest = sha256Buffer(content);
  if (!SHA256_RE.test(contentDigest)) throw new Error("RETAINED_OUTPUT_CONTENT_DIGEST_INVALID");
  const retainedRelativePath = `${RETAINED_ROOT}/${input.runId}/${contentDigest}-${safeBasename(input.sourceRelativePath)}`;
  const retainedAbsolute = resolveInside(input.repoRoot, retainedRelativePath);
  if (existsSync(retainedAbsolute)) {
    const existingStat = lstatSync(retainedAbsolute);
    if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
      throw new Error(`RETAINED_OUTPUT_EXISTING_FILE_TYPE_INVALID:${retainedRelativePath}`);
    }
    const existing = readFileSync(retainedAbsolute);
    if (sha256Buffer(existing) !== contentDigest || !existing.equals(content)) {
      throw new Error(`RETAINED_OUTPUT_EXISTING_CONTENT_MISMATCH:${retainedRelativePath}`);
    }
    return {
      sourceRelativePath: input.sourceRelativePath,
      retainedRelativePath,
      contentDigest,
      bytes: content.length,
      changed: false,
    };
  }
  mkdirSync(dirname(retainedAbsolute), { recursive: true });
  const tempPath = `${retainedAbsolute}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, content, { mode: 0o644 });
  renameSync(tempPath, retainedAbsolute);
  chmodSync(retainedAbsolute, 0o644);
  const readback = readFileSync(retainedAbsolute);
  if (sha256Buffer(readback) !== contentDigest || !readback.equals(content)) {
    throw new Error(`RETAINED_OUTPUT_READBACK_MISMATCH:${retainedRelativePath}`);
  }
  return {
    sourceRelativePath: input.sourceRelativePath,
    retainedRelativePath,
    contentDigest,
    bytes: content.length,
    changed: true,
  };
}

export function retainExecutorOutputs(input: {
  repoRoot: string;
  runId: string;
  outputPaths: string[];
}): RetainedExecutorOutputsResult {
  if (!RUN_ID_RE.test(input.runId)) throw new Error("RETAINED_OUTPUT_RUN_ID_INVALID");
  const historyOutputs: string[] = [];
  const retainedOutputs: RetainedExecutorOutput[] = [];
  for (const outputPath of [...new Set(input.outputPaths)]) {
    const classification = sourceClass(outputPath);
    if (classification === "IMMUTABLE") {
      historyOutputs.push(outputPath);
      continue;
    }
    const retained = retainOne({ repoRoot: input.repoRoot, runId: input.runId, sourceRelativePath: outputPath });
    retainedOutputs.push(retained);
    historyOutputs.push(retained.retainedRelativePath);
  }
  return { historyOutputs, retainedOutputs };
}
