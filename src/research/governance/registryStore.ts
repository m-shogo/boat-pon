// boat-pon 研究 Registry ストア（individual-file・append-only・Git diff 向き）。
//
// 巨大な単一 JSON に集約しない。1 record = 1 file。既存 record の上書きは拒否（append-only）。
// production / DB / sidecar に触れない。純粋な file システム操作のみ。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  contractDigest, validateDiscovery, validateExperiment, validatePromotion, validateRejection,
  validateStrategyFamily, validateStrategyVersion, validateTransferExperiment, type Validation,
} from "./contracts";

export type RegistryKind =
  | "experiments" | "discoveries" | "strategy-families" | "strategy-versions"
  | "transfer-experiments" | "promotions" | "rejections";

// registry ごとの id フィールドと validator。
const REGISTRY: Record<RegistryKind, { idField: string; validate: (x: unknown) => Validation; subkey?: string }> = {
  "experiments": { idField: "experimentId", validate: validateExperiment },
  "discoveries": { idField: "discoveryId", validate: validateDiscovery },
  "strategy-families": { idField: "strategyId", validate: validateStrategyFamily },
  // version は strategyId + version の複合 id。
  "strategy-versions": { idField: "version", validate: validateStrategyVersion, subkey: "strategyId" },
  "transfer-experiments": { idField: "transferId", validate: validateTransferExperiment },
  "promotions": { idField: "promotionId", validate: validatePromotion },
  "rejections": { idField: "rejectionId", validate: validateRejection },
};

export const REGISTRY_ROOT_DEFAULT = "research/registries";

function fileName(kind: RegistryKind, rec: Record<string, unknown>): string {
  const cfg = REGISTRY[kind];
  const id = String(rec[cfg.idField]);
  const sub = cfg.subkey ? `${String(rec[cfg.subkey])}__` : "";
  return `${sub}${id}.json`.replace(/[^0-9A-Za-z._-]/g, "_");
}

export type AppendResult = { ok: boolean; path?: string; errors: string[]; code: "OK" | "INVALID" | "DUPLICATE" };

// append-only 追加。バリデーション失敗 / 既存 file 上書きは拒否（fail-closed）。
export function appendRecord(root: string, kind: RegistryKind, record: Record<string, unknown>): AppendResult {
  const cfg = REGISTRY[kind];
  const v = cfg.validate(record);
  if (!v.valid) return { ok: false, errors: v.errors, code: "INVALID" };
  const dir = join(root, kind);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName(kind, record));
  if (existsSync(path)) return { ok: false, errors: [`append-only: record already exists: ${path}`], code: "DUPLICATE", path };
  const withDigest = { ...record, _digest: contractDigest(record), _recordedAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(withDigest, null, 2)}\n`);
  return { ok: true, path, errors: [], code: "OK" };
}

export function listRecords<T = Record<string, unknown>>(root: string, kind: RegistryKind): T[] {
  const dir = join(root, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
}

// 全 registry を validate（CI 用）。file 名と id の一致・digest 整合・append-only 破損も検出。
export function validateAllRegistries(root: string): { ok: boolean; problems: Array<{ kind: string; file: string; errors: string[] }> } {
  const problems: Array<{ kind: string; file: string; errors: string[] }> = [];
  for (const kind of Object.keys(REGISTRY) as RegistryKind[]) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      let rec: any;
      try { rec = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { problems.push({ kind, file: f, errors: ["not valid JSON"] }); continue; }
      const { _digest, _recordedAt, ...body } = rec;
      const v = REGISTRY[kind].validate(body);
      if (!v.valid) problems.push({ kind, file: f, errors: v.errors });
      if (_digest && _digest !== contractDigest(body)) problems.push({ kind, file: f, errors: ["digest mismatch (record mutated after append)"] });
      const expected = fileName(kind, body);
      if (f !== expected) problems.push({ kind, file: f, errors: [`filename should be ${expected}`] });
    }
  }
  return { ok: problems.length === 0, problems };
}

// lineage: EXP → Discovery → StrategyVersion(adopt via Transfer) → Promotion を辿れるか検証。
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
