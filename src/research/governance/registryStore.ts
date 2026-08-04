// boat-pon 研究 Registry ストア（individual-file・append-only・Git diff 向き）。
//
// 巨大な単一 JSON に集約しない。1 record = 1 file。既存 record の上書きは拒否（append-only）。
// production / DB / sidecar に触れない。純粋な file システム操作のみ。
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  contractDigest, validateDiscovery, validateExperiment, validatePromotion, validateRejection,
  validateStrategyFamily, validateStrategyVersion, validateTransferExperiment, type Validation,
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

function fileName(kind: RegistryKind, rec: Record<string, unknown>): string {
  const cfg = REGISTRY[kind];
  const id = String(rec[cfg.idField]);
  const sub = cfg.subkey ? `${String(rec[cfg.subkey])}__` : "";
  return `${sub}${id}.json`.replace(/[^0-9A-Za-z._-]/g, "_");
}

function stripMetadata(rec: Record<string, unknown>): Record<string, unknown> {
  const { _digest, _recordedAt, ...body } = rec;
  return body;
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
    if (existsSync(path)) throw new Error(`append-only target already exists: ${path}`);
    renameSync(temp, path);
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

// 厳格 append-only API。既存 file は内容が同一でも DUPLICATE として拒否する。
export function appendRecord(root: string, kind: RegistryKind, record: Record<string, unknown>): AppendResult {
  const cfg = REGISTRY[kind];
  const v = cfg.validate(record);
  if (!v.valid) return { ok: false, errors: v.errors, code: "INVALID" };
  const path = join(root, kind, fileName(kind, record));
  if (existsSync(path)) return { ok: false, errors: [`append-only: record already exists: ${path}`], code: "DUPLICATE", path };
  const withDigest = { ...record, _digest: contractDigest(record), _recordedAt: new Date().toISOString() };
  try {
    atomicCreateUtf8(path, `${JSON.stringify(withDigest, null, 2)}\n`);
    return { ok: true, path, errors: [], code: "OK" };
  } catch (e) {
    return { ok: false, path, errors: [e instanceof Error ? e.message : String(e)], code: "WRITE_FAILED" };
  }
}

// Executor retry 用。既存recordのcanonical bodyが同一なら安全な再実行として成功、異なるならfail-closed。
export function appendRecordIdempotent(root: string, kind: RegistryKind, record: Record<string, unknown>): AppendResult {
  const cfg = REGISTRY[kind];
  const v = cfg.validate(record);
  if (!v.valid) return { ok: false, errors: v.errors, code: "INVALID" };
  const path = join(root, kind, fileName(kind, record));
  const expectedDigest = contractDigest(record);
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const body = stripMetadata(existing);
      const storedDigest = typeof existing._digest === "string" ? existing._digest : contractDigest(body);
      if (storedDigest === expectedDigest && contractDigest(body) === expectedDigest) {
        return { ok: true, path, errors: [], code: "ALREADY_RECORDED" };
      }
      return { ok: false, path, errors: [`registry conflict: same id has different body: ${path}`], code: "CONFLICT" };
    } catch (e) {
      return { ok: false, path, errors: [`registry conflict: unreadable existing record: ${e instanceof Error ? e.message : String(e)}`], code: "CONFLICT" };
    }
  }
  return appendRecord(root, kind, record);
}

export function listRecords<T = Record<string, unknown>>(root: string, kind: RegistryKind): T[] {
  const dir = join(root, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
}

export function validateAllRegistries(root: string): { ok: boolean; problems: Array<{ kind: string; file: string; errors: string[] }> } {
  const problems: Array<{ kind: string; file: string; errors: string[] }> = [];
  for (const kind of Object.keys(REGISTRY) as RegistryKind[]) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      let rec: Record<string, unknown>;
      try { rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>; }
      catch { problems.push({ kind, file: f, errors: ["not valid JSON"] }); continue; }
      const body = stripMetadata(rec);
      const v = REGISTRY[kind].validate(body);
      if (!v.valid) problems.push({ kind, file: f, errors: v.errors });
      if (typeof rec._digest !== "string") problems.push({ kind, file: f, errors: ["missing _digest"] });
      else if (rec._digest !== contractDigest(body)) problems.push({ kind, file: f, errors: ["digest mismatch (record mutated after append)"] });
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
  const transfers = listRecords<any>(root, "transfer-experiments");
  const promotions = listRecords<any>(root, "promotions");
  const expIds = new Set(experiments.map((e) => e.experimentId));
  const discIds = new Set(discoveries.map((d) => d.discoveryId));
  const xferIds = new Set(transfers.map((t) => t.transferId));

  for (const d of discoveries) for (const eid of d.sourceExperimentIds ?? []) if (!expIds.has(eid)) problems.push(`discovery ${d.discoveryId} references missing experiment ${eid}`);
  for (const t of transfers) if (!discIds.has(t.sourceDiscoveryId)) problems.push(`transfer ${t.transferId} references missing discovery ${t.sourceDiscoveryId}`);
  for (const p of promotions) for (const xid of p.transferExperimentIds ?? []) if (!xferIds.has(xid)) problems.push(`promotion ${p.promotionId} references missing transfer ${xid}`);
  return { ok: problems.length === 0, problems };
}
