// boat-pon 研究 Executor SDK（共通ライフサイクル + guard）。
//
// ライフサイクル: prepare → validateInputs → executeReadOnly → writeArtifact →
//                verifyArtifact → recordEvidence → transitionState。
// 全 executor は read-only。production / DB write / credential に触れない。
// 未実装 executor は planner を無限反復させず ENGINEERING_REQUIRED で停止する。
import { createHash } from "node:crypto";

export const EXECUTOR_SDK_VERSION = "research-executor-sdk-v1";

export type SdkResult = "PASS" | "CONDITIONAL" | "BLOCKED" | "FAILED" | "ENGINEERING_REQUIRED";

export type SdkContext = {
  repoRoot: string;
  runId: string;
  taskId: string;
  dataRoot: string;
  dryRun: boolean;
  // 生成物 path allowlist（write-scope guard）。この prefix 以外へ書いたら違反。
  writeAllowlist: string[];
};

export type ArtifactRecord = { outputs: string[]; digest: string; summary: Record<string, unknown> };

export type ExecutorSpec = {
  name: string;                       // taskType
  safetyLevel: "L0" | "L1" | "L2" | "L3";
  implemented: boolean;               // false → ENGINEERING_REQUIRED
  engineeringNote?: string;           // 未実装時の設計メモ（何が必要か）
  inputContract: (ctx: SdkContext) => { ok: boolean; errors: string[] };
  executeReadOnly: (ctx: SdkContext) => ArtifactRecord;   // 実行本体（read-only）
  // PIT / leakage の自己申告（executor が保証する不変条件）。
  pitGuarantee: () => { pit: boolean; sameRaceLeakage: boolean; futureLeakage: boolean };
};

export type SdkOutcome = {
  result: SdkResult;
  taskId: string;
  executorVersion: string;
  outputs: string[];
  digest: string;
  summary: Record<string, unknown>;
  blocks: string[];
  lifecycle: string[];               // 通過した段階
};

// ---- 純粋 guard ----
export function checkWriteScope(writtenPaths: string[], allowlist: string[]): { ok: boolean; violations: string[] } {
  const violations = writtenPaths.filter((p) => p.includes("..") || p.startsWith("/") || !allowlist.some((a) => p === a || p.startsWith(a)));
  return { ok: violations.length === 0, violations };
}
const SECRET_RE = /(ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{10,})/;
export function checkNoSecrets(text: string): { ok: boolean; matched: boolean } {
  return { ok: !SECRET_RE.test(text), matched: SECRET_RE.test(text) };
}
// production isolation: research config は production / BUY / app_settings / 投票 endpoint を参照しない。
const PRODUCTION_MARKERS = ["app_settings", "production_writer", "auto_vote", "auto_purchase", "buy_condition", "live_odds_writer"];
export function checkProductionIsolation(configText: string): { ok: boolean; markers: string[] } {
  const markers = PRODUCTION_MARKERS.filter((m) => configText.includes(m));
  return { ok: markers.length === 0, markers };
}
export function idempotencyKey(parts: Record<string, string | number>): string {
  const canonical = Object.keys(parts).sort().map((k) => `${k}=${parts[k]}`).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

// ---- ライフサイクル runner ----
export function runExecutorLifecycle(spec: ExecutorSpec, ctx: SdkContext): SdkOutcome {
  const lifecycle: string[] = ["prepare"];
  const base = { taskId: ctx.taskId, executorVersion: EXECUTOR_SDK_VERSION, outputs: [] as string[], digest: "", summary: {} as Record<string, unknown>, blocks: [] as string[], lifecycle };

  // 未実装 → ENGINEERING_REQUIRED（planner を無限反復させない）。
  if (!spec.implemented) {
    return { ...base, result: "ENGINEERING_REQUIRED", blocks: ["EXECUTOR_NOT_IMPLEMENTED"], summary: { engineeringNote: spec.engineeringNote ?? "executor 未実装。設計・実装が必要。", taskType: spec.name } };
  }

  // validateInputs
  lifecycle.push("validateInputs");
  const inv = spec.inputContract(ctx);
  if (!inv.ok) return { ...base, result: "BLOCKED", blocks: ["INPUT_CONTRACT", ...inv.errors] };

  // executeReadOnly
  lifecycle.push("executeReadOnly");
  let art: ArtifactRecord;
  try { art = spec.executeReadOnly(ctx); }
  catch (e) { return { ...base, result: "FAILED", blocks: ["EXECUTOR_EXCEPTION", (e instanceof Error ? e.message : String(e)).slice(0, 200)] }; }

  // writeArtifact scope guard
  lifecycle.push("writeArtifact");
  const scope = checkWriteScope(art.outputs, ctx.writeAllowlist);
  if (!scope.ok) return { ...base, result: "BLOCKED", blocks: ["WRITE_SCOPE_VIOLATION", ...scope.violations], outputs: art.outputs };

  // verifyArtifact: digest 整合 + secret scan
  lifecycle.push("verifyArtifact");
  const digest = createHash("sha256").update(JSON.stringify(art.summary, Object.keys(art.summary).sort())).digest("hex");
  const secret = checkNoSecrets(JSON.stringify(art.summary));
  if (!secret.ok) return { ...base, result: "BLOCKED", blocks: ["SECRET_IN_ARTIFACT"], outputs: art.outputs };

  // PIT / leakage guard
  const pit = spec.pitGuarantee();
  if (!pit.pit || pit.sameRaceLeakage || pit.futureLeakage) {
    return { ...base, result: "BLOCKED", blocks: ["PIT_OR_LEAKAGE_VIOLATION"], outputs: art.outputs, summary: { pit } };
  }

  // recordEvidence + transitionState は runner 側（本 SDK は結果を返すのみ）。
  lifecycle.push("recordEvidence", "transitionState");
  return { ...base, result: "PASS", outputs: art.outputs, digest: art.digest || digest, summary: { ...art.summary, pit }, lifecycle };
}
