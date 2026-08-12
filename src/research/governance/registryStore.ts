// boat-pon 研究 Registry ストア（individual-file・append-only・Git diff 向き）。
//
// 巨大な単一 JSON に集約しない。1 record = 1 file。既存 record の上書きは拒否（append-only）。
// production / DB / sidecar に触れない。純粋な file システム操作のみ。
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync,
  readdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { TextDecoder } from "node:util";
import {
  CONTRACT_DIGEST_VERSION, contractDigest, legacyContractDigest, validateDiscovery, validateExperiment, validatePromotion,
  validateRejection, validateStrategyFamily, validateStrategyVersion, validateTransferExperiment, type Validation,
} from "./contracts";

export type RegistryKind =
  | "experiments" | "discoveries" | "strategy-families" | "strategy-versions"
  | "transfer-experiments" | "promotions" | "rejections";

const REGISTRY: Record<RegistryKind, { idField: string; validate: (x: unknown) => Validation; subkey?: string }> = {
  experiments: { idField: "experimentId", validate: validateExperiment },
  discoveries: { idField: "discoveryId", validate: validateDiscovery },
  "strategy-families": { idField: "strategyId", validate: validateStrategyFamily },
  "strategy-versions": { idField: "version", validate: validateStrategyVersion, subkey: "strategyId" },
  "transfer-experiments": { idField: "transferId", validate: validateTransferExperiment },
  promotions: { idField: "promotionId", validate: validatePromotion },
  rejections: { idField: "rejectionId", validate: validateRejection },
};

export const REGISTRY_ROOT_DEFAULT = "research/registries";
const REGISTRY_READ_CHUNK_BYTES = 64 * 1024;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fileName(kind: RegistryKind, rec: Record<string, unknown>): string {
  const cfg = REGISTRY[kind];
  const id = String(rec[cfg.idField]);
  const sub = cfg.subkey ? `${String(rec[cfg.subkey])}__` : "";
  return `${sub}${id}.json`.replace(/[^0-9A-Za-z._-]/g, "_");
}

function stripMetadata(rec: Record<string, unknown>): Record<string, unknown> {
  const { _digest, _digestVersion, _recordedAt, ...body } = rec;
  return body;
}

function verifyStoredDigest(rec: Record<string, unknown>, body: Record<string, unknown>): string | null {
  if (typeof rec._digest !== "string") return "missing _digest";
  if (rec._digestVersion === undefined) {
    return rec._digest === legacyContractDigest(body) ? null : "legacy digest mismatch (record mutated after append)";
  }
  if (rec._digestVersion !== CONTRACT_DIGEST_VERSION) {
    return `unsupported _digestVersion: ${String(rec._digestVersion)}`;
  }
  return rec._digest === contractDigest(body) ? null : "digest mismatch (record mutated after append)";
}

function lstatRegistryPath(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function assertRegistryAncestorsSafe(path: string): void {
  const ancestors: string[] = [];
  let cursor = dirname(path);
  while (true) {
    ancestors.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const ancestor of ancestors.reverse()) {
    const stat = lstatRegistryPath(ancestor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`registry ancestor symlink forbidden: ${ancestor}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`registry ancestor must be directory: ${ancestor}`);
    }
  }
}

function assertRegistryDirectorySafe(path: string, role: string): void {
  const stat = lstatRegistryPath(path);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    throw new Error(`registry symlink forbidden (${role}): ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`registry container must be directory (${role}): ${path}`);
  }
}

function assertRegistryContainerSafe(root: string, kind: RegistryKind): void {
  assertRegistryAncestorsSafe(root);
  assertRegistryDirectorySafe(root, "root");
  assertRegistryDirectorySafe(join(root, kind), "kind");
}

function readRegistryRecordUtf8(path: string): string {
  let fd: number | null = null;
  try {
    // O_NOFOLLOW closes the record-level lstat -> read TOCTOU window for
    // symlink swaps. O_NONBLOCK prevents a raced FIFO/device replacement from
    // blocking before fstat can reject it. The read stays bound to this fd.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`registry record must be regular file: ${path}`);
    }
    if (stat.nlink !== 1) {
      throw new Error(`registry record hardlink forbidden: ${path}`);
    }
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
      throw new Error(`registry record size invalid: ${path}`);
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithSentinel = stat.size - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(REGISTRY_READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > stat.size) {
        throw new Error(`registry record changed during read: ${path}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const postReadStat = fstatSync(fd);
    if (postReadStat.size !== stat.size || totalBytes !== stat.size) {
      throw new Error(`registry record changed during read: ${path}`);
    }
    try {
      return STRICT_UTF8_DECODER.decode(Buffer.concat(chunks, totalBytes));
    } catch {
      throw new Error(`registry record invalid utf8: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error(`registry symlink forbidden (record): ${path}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function atomicCreateUtf8(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    try {
      // Publishing with a hard link is atomic and never replaces an existing
      // destination. Unlike renameSync(), a concurrent writer that wins the
      // target path causes EEXIST instead of violating append-only semantics.
      linkSync(temp, path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new Error(`append-only target already exists: ${path}`);
      }
      throw error;
    }
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export type AppendResult = {
  ok: boolean;
  path?: string;
  errors: string[];
  code: "OK" | "ALREADY_RECORDED" | "INVALID" | "DUPLICATE" | "CONFLICT" | "WRITE_FAILED";
};

function appendNew(root: string, kind: RegistryKind, record: Record<string, unknown>): AppendResult {
  const cfg = REGISTRY[kind];
  const v = cfg.validate(record);
  if (!v.valid) return { ok: false, errors: v.errors, code: "INVALID" };
  try {
    assertRegistryContainerSafe(root, kind);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], code: "WRITE_FAILED" };
  }
  const path = join(root, kind, fileName(kind, record));
  if (existsSync(path)) return { ok: false, errors: [`append-only: record already exists: ${path}`], code: "DUPLICATE", path };
  const withDigest = {
    ...record,
    _digest: contractDigest(record),
    _digestVersion: CONTRACT_DIGEST_VERSION,
    _recordedAt: new Date().toISOString(),
  };
  try {
    atomicCreateUtf8(path, `${JSON.stringify(withDigest, null, 2)}\n`);
    return { ok: true, path, errors: [], code: "OK" };
  } catch (e) {
    return { ok: false, path, errors: [e instanceof Error ? e.message : String(e)], code: "WRITE_FAILED" };
  }
}

// 明示的に重複を拒否したい管理処理向け。
export function appendRecordStrict(root: string, kind: RegistryKind, record: Record<string, unknown>): AppendResult {
  return appendNew(root, kind, record);
}

// Executor retry 用。既存recordのcanonical bodyが同一なら安全な再実行として成功、異なるならfail-closed。
export function appendRecordIdempotent(root: string, kind: RegistryKind, record: Record<string, unknown>): AppendResult {
  const cfg = REGISTRY[kind];
  const v = cfg.validate(record);
  if (!v.valid) return { ok: false, errors: v.errors, code: "INVALID" };
  try {
    assertRegistryContainerSafe(root, kind);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], code: "CONFLICT" };
  }
  const path = join(root, kind, fileName(kind, record));
  const expectedDigest = contractDigest(record);
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(readRegistryRecordUtf8(path)) as Record<string, unknown>;
      const body = stripMetadata(existing);
      const storedDigestProblem = verifyStoredDigest(existing, body);
      if (storedDigestProblem) {
        return { ok: false, path, errors: [`registry conflict: ${storedDigestProblem}: ${path}`], code: "CONFLICT" };
      }
      if (contractDigest(body) === expectedDigest) {
        return { ok: true, path, errors: [], code: "ALREADY_RECORDED" };
      }
      return { ok: false, path, errors: [`registry conflict: same id has different body: ${path}`], code: "CONFLICT" };
    } catch (e) {
      return { ok: false, path, errors: [`registry conflict: unreadable existing record: ${e instanceof Error ? e.message : String(e)}`], code: "CONFLICT" };
    }
  }
  return appendNew(root, kind, record);
}

// 既存executor互換API。戻り値を見落としても不正・競合・write失敗は例外で停止する。
export function appendRecord(root: string, kind: RegistryKind, record: Record<string, unknown>): AppendResult {
  const result = appendRecordIdempotent(root, kind, record);
  if (!result.ok) throw new Error(`${result.code}: ${result.errors.join("; ")}`);
  return result;
}

export function listRecords<T = Record<string, unknown>>(root: string, kind: RegistryKind): T[] {
  assertRegistryContainerSafe(root, kind);
  const dir = join(root, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readRegistryRecordUtf8(join(dir, f))) as T);
}

export function validateAllRegistries(root: string): { ok: boolean; problems: Array<{ kind: string; file: string; errors: string[] }> } {
  const problems: Array<{ kind: string; file: string; errors: string[] }> = [];
  for (const kind of Object.keys(REGISTRY) as RegistryKind[]) {
    try {
      assertRegistryContainerSafe(root, kind);
    } catch (e) {
      problems.push({ kind, file: "<registry>", errors: [e instanceof Error ? e.message : String(e)] });
      continue;
    }
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(readRegistryRecordUtf8(join(dir, f))) as Record<string, unknown>;
      }
      catch (e) {
        problems.push({ kind, file: f, errors: [e instanceof Error && (
          e.message.includes("registry symlink forbidden")
          || e.message.includes("registry record must be regular file")
          || e.message.includes("registry record hardlink forbidden")
          || e.message.includes("registry record size invalid")
          || e.message.includes("registry record changed during read")
          || e.message.includes("registry record invalid utf8")
        ) ? e.message : "not valid JSON"] });
        continue;
      }
      const body = stripMetadata(rec);
      const v = REGISTRY[kind].validate(body);
      if (!v.valid) problems.push({ kind, file: f, errors: v.errors });
      const digestProblem = verifyStoredDigest(rec, body);
      if (digestProblem) problems.push({ kind, file: f, errors: [digestProblem] });
      const expected = fileName(kind, body);
      if (f !== expected) problems.push({ kind, file: f, errors: [`filename should be ${expected}`] });
    }
  }
  return { ok: problems.length === 0, problems };
}

export function checkLineage(root: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const experiments = listRecords<any>(root, "experiments");
  const discoveries = listRecords<any>(root, "discoveries");
  const families = listRecords<any>(root, "strategy-families");
  const versions = listRecords<any>(root, "strategy-versions");
  const transfers = listRecords<any>(root, "transfer-experiments");
  const promotions = listRecords<any>(root, "promotions");
  const rejections = listRecords<any>(root, "rejections");
  const expIds = new Set(experiments.map((e) => e.experimentId));
  const discIds = new Set(discoveries.map((d) => d.discoveryId));
  const familyIds = new Set(families.map((f) => f.strategyId));
  const versionIds = new Set(versions.map((v) => `${v.strategyId}|${v.version}`));
  const xferById = new Map(transfers.map((t) => [t.transferId, t]));
  const acceptedAdoptions = new Set(
    transfers.filter((t) => t.result === "accepted").map((t) => `${t.sourceDiscoveryId}|${t.targetStrategyId}`),
  );

  for (const f of families) for (const eid of f.parentExperimentIds ?? []) if (!expIds.has(eid)) problems.push(`strategy family ${f.strategyId} references missing experiment ${eid}`);
  for (const v of versions) {
    if (!familyIds.has(v.strategyId)) problems.push(`strategy version ${v.strategyId}/${v.version} references missing strategy family ${v.strategyId}`);
    for (const did of v.adoptedDiscoveryIds ?? []) {
      if (!discIds.has(did)) problems.push(`strategy version ${v.strategyId}/${v.version} references missing adopted discovery ${did}`);
      else if (!acceptedAdoptions.has(`${did}|${v.strategyId}`)) problems.push(`strategy version ${v.strategyId}/${v.version} adopted ${did} without accepted transfer`);
    }
  }
  for (const d of discoveries) {
    for (const eid of d.sourceExperimentIds ?? []) if (!expIds.has(eid)) problems.push(`discovery ${d.discoveryId} references missing experiment ${eid}`);
    if (d.sourceStrategyId == null) {
      if (d.sourceStrategyVersion != null) problems.push(`discovery ${d.discoveryId} has source strategy version without source strategy`);
    } else {
      if (!familyIds.has(d.sourceStrategyId)) problems.push(`discovery ${d.discoveryId} references missing source strategy family ${d.sourceStrategyId}`);
      if (d.sourceStrategyVersion == null) problems.push(`discovery ${d.discoveryId} is missing source strategy version for ${d.sourceStrategyId}`);
      else if (!versionIds.has(`${d.sourceStrategyId}|${d.sourceStrategyVersion}`)) problems.push(`discovery ${d.discoveryId} references missing source strategy version ${d.sourceStrategyId}/${d.sourceStrategyVersion}`);
    }
  }
  for (const t of transfers) {
    if (!discIds.has(t.sourceDiscoveryId)) problems.push(`transfer ${t.transferId} references missing discovery ${t.sourceDiscoveryId}`);
    if (!familyIds.has(t.targetStrategyId)) problems.push(`transfer ${t.transferId} references missing strategy family ${t.targetStrategyId}`);
    if (!versionIds.has(`${t.targetStrategyId}|${t.baseVersion}`)) problems.push(`transfer ${t.transferId} references missing base strategy version ${t.targetStrategyId}/${t.baseVersion}`);
  }
  for (const p of promotions) {
    if (!familyIds.has(p.strategyId)) problems.push(`promotion ${p.promotionId} references missing strategy family ${p.strategyId}`);
    if (!versionIds.has(`${p.strategyId}|${p.fromVersion}`)) problems.push(`promotion ${p.promotionId} references missing strategy version ${p.strategyId}/${p.fromVersion}`);
    for (const xid of p.transferExperimentIds ?? []) {
      const transfer = xferById.get(xid);
      if (!transfer) {
        problems.push(`promotion ${p.promotionId} references missing transfer ${xid}`);
        continue;
      }
      if (transfer.targetStrategyId !== p.strategyId) problems.push(`promotion ${p.promotionId} references transfer ${xid} for different strategy ${transfer.targetStrategyId}`);
      if (["active_research", "challenger"].includes(p.toState) && transfer.result !== "accepted") problems.push(`promotion ${p.promotionId} requires accepted transfer ${xid} for ${p.toState}`);
    }
  }
  for (const r of rejections) {
    const exists = r.subjectType === "experiment" ? expIds.has(r.subjectId)
      : r.subjectType === "discovery" ? discIds.has(r.subjectId)
      : r.subjectType === "strategy" ? familyIds.has(r.subjectId)
      : r.subjectType === "transfer" ? xferById.has(r.subjectId)
      : false;
    if (!exists) problems.push(`rejection ${r.rejectionId} references missing ${r.subjectType} ${r.subjectId}`);
  }
  return { ok: problems.length === 0, problems };
}