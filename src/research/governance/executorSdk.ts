// boat-pon 研究 Executor SDK（共通ライフサイクル + fail-closed guard）。
//
// PASS は実体を伴う write/readback/evidence/state transition の完了後だけ返す。
// dry-run は一切 write せず、plan と入力・PIT evidence の検査だけを行う。
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

export const EXECUTOR_SDK_VERSION = "research-executor-sdk-v2";

export type SdkResult = "PASS" | "CONDITIONAL" | "BLOCKED" | "FAILED" | "ENGINEERING_REQUIRED";

export type SdkContext = {
  repoRoot: string;
  runId: string;
  taskId: string;
  dataRoot: string;
  dryRun: boolean;
  writeAllowlist: string[];
};

export type PitEvidence = {
  status: "PASS" | "NOT_APPLICABLE";
  validatorId: string;
  validatorVersion: string;
  checkedRecordCount: number;
  sameRaceViolationCount: number;
  futureViolationCount: number;
  ambiguousTimingCount: number;
  evidencePath: string | null;
  evidenceDigest: string | null;
  notApplicableReason: string | null;
};

export type ArtifactRecord = {
  outputs: string[]; // planned relative paths
  digest: string;
  summary: Record<string, unknown>;
};

export type StageResult = { ok: boolean; errors: string[]; outputs?: string[] };

export type ExecutorSpec = {
  name: string;
  safetyLevel: "L0" | "L1" | "L2" | "L3";
  implemented: boolean;
  engineeringNote?: string;
  inputContract: (ctx: SdkContext) => { ok: boolean; errors: string[] };
  executeReadOnly: (ctx: SdkContext) => ArtifactRecord;
  pitEvidence?: (ctx: SdkContext, artifact: ArtifactRecord) => PitEvidence;
  /** @deprecated compatibility only. New executors must use pitEvidence. */
  pitGuarantee?: () => { pit: boolean; sameRaceLeakage: boolean; futureLeakage: boolean };
  writeArtifacts?: (ctx: SdkContext, artifact: ArtifactRecord) => StageResult;
  verifyArtifacts?: (ctx: SdkContext, artifact: ArtifactRecord, writtenOutputs: string[]) => StageResult;
  recordEvidence?: (ctx: SdkContext, artifact: ArtifactRecord, writtenOutputs: string[]) => StageResult;
  transitionState?: (ctx: SdkContext, artifact: ArtifactRecord, writtenOutputs: string[]) => StageResult;
};

export type SdkOutcome = {
  result: SdkResult;
  taskId: string;
  executorVersion: string;
  outputs: string[];
  digest: string;
  summary: Record<string, unknown>;
  blocks: string[];
  lifecycle: string[];
};

export function checkWriteScope(writtenPaths: string[], allowlist: string[]): { ok: boolean; violations: string[] } {
  const violations = writtenPaths.filter((p) => p.includes("..") || p.startsWith("/") || !allowlist.some((a) => p === a || p.startsWith(a)));
  return { ok: violations.length === 0, violations };
}

const SECRET_RE = /(ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{10,})/;
export function checkNoSecrets(text: string): { ok: boolean; matched: boolean } {
  const matched = SECRET_RE.test(text);
  return { ok: !matched, matched };
}

const PRODUCTION_MARKERS = ["app_settings", "production_writer", "auto_vote", "auto_purchase", "buy_condition", "live_odds_writer"];
export function checkProductionIsolation(configText: string): { ok: boolean; markers: string[] } {
  const markers = PRODUCTION_MARKERS.filter((m) => configText.includes(m));
  return { ok: markers.length === 0, markers };
}

export function idempotencyKey(parts: Record<string, string | number>): string {
  const canonical = Object.keys(parts).sort().map((k) => `${k}=${parts[k]}`).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function atomicWriteUtf8(path: string, content: string, allowReplace = false): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    if (!allowReplace && existsSync(path)) throw new Error(`target already exists: ${path}`);
    renameSync(temp, path);
  } finally {
    if (fd !== null) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function atomicWriteJson(path: string, value: unknown, allowReplace = false): string {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  atomicWriteUtf8(path, content, allowReplace);
  return sha256Text(content);
}

export function verifyJsonReadback(path: string, expectedOutputDigest?: string): StageResult {
  if (!existsSync(path)) return { ok: false, errors: [`artifact missing: ${path}`] };
  try {
    const text = readFileSync(path, "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (expectedOutputDigest && parsed.outputDigest !== expectedOutputDigest) {
      return { ok: false, errors: [`artifact outputDigest mismatch: ${path}`] };
    }
    return { ok: true, errors: [] };
  } catch (e) {
    return { ok: false, errors: [`artifact readback failed: ${path}: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

function normalizePitEvidence(spec: ExecutorSpec, ctx: SdkContext, artifact: ArtifactRecord): PitEvidence | null {
  if (spec.pitEvidence) return spec.pitEvidence(ctx, artifact);
  // dataset-expand is settlement inventory only; prediction-time PIT is formally not applicable.
  if (spec.name === "dataset-expand") {
    const checked = Number((artifact.summary.inventoryTotals as any)?.candidates ?? (artifact.summary as any).totalActiveCandidates ?? 0);
    return {
      status: "NOT_APPLICABLE",
      validatorId: "settlement-inventory-pit-applicability",
      validatorVersion: "v1",
      checkedRecordCount: checked,
      sameRaceViolationCount: 0,
      futureViolationCount: 0,
      ambiguousTimingCount: 0,
      evidencePath: null,
      evidenceDigest: null,
      notApplicableReason: "settlement inventory contains labels only and does not join prediction-time features",
    };
  }
  // Legacy compatibility is fail-closed unless its assertion is clean; new code must migrate to pitEvidence.
  if (spec.pitGuarantee) {
    const legacy = spec.pitGuarantee();
    if (!legacy.pit || legacy.sameRaceLeakage || legacy.futureLeakage) return null;
    return {
      status: "PASS",
      validatorId: "legacy-pit-assertion",
      validatorVersion: "deprecated-v1",
      checkedRecordCount: 0,
      sameRaceViolationCount: 0,
      futureViolationCount: 0,
      ambiguousTimingCount: 0,
      evidencePath: null,
      evidenceDigest: null,
      notApplicableReason: null,
    };
  }
  return null;
}

function failed(base: Omit<SdkOutcome, "result">, result: SdkResult, blocks: string[], summary?: Record<string, unknown>, outputs?: string[]): SdkOutcome {
  return { ...base, result, blocks, summary: summary ?? base.summary, outputs: outputs ?? base.outputs };
}

export function runExecutorLifecycle(spec: ExecutorSpec, ctx: SdkContext): SdkOutcome {
  const lifecycle: string[] = ["prepare"];
  const base: Omit<SdkOutcome, "result"> = {
    taskId: ctx.taskId,
    executorVersion: EXECUTOR_SDK_VERSION,
    outputs: [],
    digest: "",
    summary: {},
    blocks: [],
    lifecycle,
  };

  if (!spec.implemented) {
    return failed(base, "ENGINEERING_REQUIRED", ["EXECUTOR_NOT_IMPLEMENTED"], {
      engineeringNote: spec.engineeringNote ?? "executor implementation required",
      taskType: spec.name,
    });
  }

  lifecycle.push("validateInputs");
  const input = spec.inputContract(ctx);
  if (!input.ok) return failed(base, "BLOCKED", ["INPUT_CONTRACT", ...input.errors]);

  lifecycle.push("executeReadOnly");
  let artifact: ArtifactRecord;
  try { artifact = spec.executeReadOnly(ctx); }
  catch (e) { return failed(base, "FAILED", ["EXECUTOR_EXCEPTION", (e instanceof Error ? e.message : String(e)).slice(0, 300)]); }

  const scope = checkWriteScope(artifact.outputs, ctx.writeAllowlist);
  if (!scope.ok) return failed(base, "BLOCKED", ["WRITE_SCOPE_VIOLATION", ...scope.violations], artifact.summary, artifact.outputs);
  if (!checkNoSecrets(JSON.stringify(artifact.summary)).ok) return failed(base, "BLOCKED", ["SECRET_IN_ARTIFACT"], artifact.summary);

  const digest = artifact.digest || sha256Text(JSON.stringify(artifact.summary, Object.keys(artifact.summary).sort()));
  base.digest = digest;
  base.summary = artifact.summary;

  lifecycle.push("validatePitEvidence");
  const pitEvidence = normalizePitEvidence(spec, ctx, artifact);
  if (!pitEvidence) return failed(base, "BLOCKED", ["PIT_EVIDENCE_MISSING_OR_INVALID"], artifact.summary);
  if (pitEvidence.sameRaceViolationCount > 0 || pitEvidence.futureViolationCount > 0 || pitEvidence.ambiguousTimingCount > 0) {
    return failed(base, "BLOCKED", ["PIT_OR_LEAKAGE_VIOLATION"], { ...artifact.summary, pitEvidence });
  }
  base.summary = { ...artifact.summary, pitEvidence };

  if (ctx.dryRun) {
    lifecycle.push("dryRunComplete");
    return { ...base, result: "PASS", outputs: [] };
  }

  if (!spec.writeArtifacts || !spec.verifyArtifacts || !spec.recordEvidence || !spec.transitionState) {
    return failed(base, "BLOCKED", ["INCOMPLETE_EXECUTOR_LIFECYCLE_CALLBACKS"], base.summary);
  }

  lifecycle.push("writeArtifacts");
  const written = spec.writeArtifacts(ctx, { ...artifact, digest, summary: base.summary });
  if (!written.ok) return failed(base, "FAILED", ["ARTIFACT_WRITE_FAILED", ...written.errors], base.summary, written.outputs ?? []);
  const writtenOutputs = written.outputs ?? artifact.outputs;
  const writtenScope = checkWriteScope(writtenOutputs, ctx.writeAllowlist);
  if (!writtenScope.ok) return failed(base, "BLOCKED", ["WRITE_SCOPE_VIOLATION", ...writtenScope.violations], base.summary, writtenOutputs);

  lifecycle.push("verifyArtifactsByReadback");
  const verified = spec.verifyArtifacts(ctx, { ...artifact, digest, summary: base.summary }, writtenOutputs);
  if (!verified.ok) return failed(base, "FAILED", ["ARTIFACT_VERIFY_FAILED", ...verified.errors], base.summary, writtenOutputs);

  lifecycle.push("recordEvidence");
  const evidence = spec.recordEvidence(ctx, { ...artifact, digest, summary: base.summary }, writtenOutputs);
  if (!evidence.ok) return failed(base, "FAILED", ["EVIDENCE_RECORD_FAILED", ...evidence.errors], base.summary, writtenOutputs);
  const evidenceOutputs = evidence.outputs ?? writtenOutputs;

  lifecycle.push("transitionState");
  const transition = spec.transitionState(ctx, { ...artifact, digest, summary: base.summary }, evidenceOutputs);
  if (!transition.ok) return failed(base, "FAILED", ["STATE_TRANSITION_FAILED", ...transition.errors], base.summary, evidenceOutputs);

  return { ...base, result: "PASS", outputs: transition.outputs ?? evidenceOutputs };
}
