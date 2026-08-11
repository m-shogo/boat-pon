// boat-pon 研究 Executor SDK（共通ライフサイクル + fail-closed guard）。
//
// PASS は実体を伴う write/readback/evidence/state transition の完了後だけ返す。
// dry-run は一切 write せず、plan と入力・PIT evidence の検査だけを行う。
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export const EXECUTOR_SDK_VERSION = "research-executor-sdk-v3";

// DRY_RUN_OK は dry-run 専用の非永続結果。SDK は dry-run で PASS を返さない（PASS 誤認の防止）。
// queue-state への PASS 遷移は外部 orchestrator（runner）だけが行う（SDK は行わない）。
export type SdkResult = "PASS" | "DRY_RUN_OK" | "CONDITIONAL" | "BLOCKED" | "FAILED" | "ENGINEERING_REQUIRED";

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
  /**
   * evidence 完成後の最終検証コールバック。**queue-state を変更してはならない**。
   * queue-state の CAS / PASS 遷移 / current-run / processed ledger は外部 orchestrator（runner）が
   * 単独で担当する（責任境界: ADR-0005 / docs/research-automation-operating-model.md）。
   * 旧名 transitionState は誤解を招くため finalizeEvidence に改名した。
   */
  finalizeEvidence?: (ctx: SdkContext, artifact: ArtifactRecord, writtenOutputs: string[]) => StageResult;
};

// SDK は artifact + evidence の完成までを保証する。queue-state 遷移は外部 orchestrator が行う。
export const STATE_TRANSITION_OWNER = "EXTERNAL_ORCHESTRATOR" as const;

export type SdkOutcome = {
  result: SdkResult;
  taskId: string;
  executorVersion: string;
  outputs: string[];
  digest: string;
  summary: Record<string, unknown>;
  blocks: string[];
  lifecycle: string[];
  /** 責任境界の明示: SDK は queue-state を変更しない。 */
  stateTransitionOwner: typeof STATE_TRANSITION_OWNER;
  stateTransitionPerformedByExecutor: false;
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

function assertRealDirectoryAncestors(path: string): void {
  const parents: string[] = [];
  let cursor = resolve(dirname(path));
  while (true) {
    parents.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  for (const parent of parents.reverse()) {
    try {
      const stat = lstatSync(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`parent path must be a real directory: ${parent}`);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

export function atomicWriteUtf8(path: string, content: string, allowReplace = false): void {
  assertRealDirectoryAncestors(path);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    if (allowReplace) {
      renameSync(temp, path);
    } else {
      try {
        // Publish atomically without ever replacing an append-only destination.
        // A concurrent creator wins with EEXIST instead of being overwritten by renameSync().
        linkSync(temp, path);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new Error(`target already exists: ${path}`);
        }
        throw error;
      }
    }
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
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`artifact must be a single-link regular file: ${path}`);
    }
    const text = readFileSync(fd, "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (expectedOutputDigest && parsed.outputDigest !== expectedOutputDigest) {
      return { ok: false, errors: [`artifact outputDigest mismatch: ${path}`] };
    }
    return { ok: true, errors: [] };
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") {
      return { ok: false, errors: [`artifact missing: ${path}`] };
    }
    if (e instanceof Error && "code" in e && e.code === "ELOOP") {
      return { ok: false, errors: [`artifact readback failed: ${path}: symlink forbidden`] };
    }
    return { ok: false, errors: [`artifact readback failed: ${path}: ${e instanceof Error ? e.message : String(e)}`] };
  } finally {
    if (fd !== null) closeSync(fd);
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
    stateTransitionOwner: STATE_TRANSITION_OWNER,
    stateTransitionPerformedByExecutor: false,
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
    // dry-run は write/evidence/finalize を一切実行せず、PASS も返さない（PASS 誤認防止）。
    // 外部 orchestrator は DRY_RUN_OK を通常 PASS と区別して非永続に扱う。
    lifecycle.push("dryRunComplete");
    return { ...base, result: "DRY_RUN_OK", outputs: [] };
  }

  if (!spec.writeArtifacts || !spec.verifyArtifacts || !spec.recordEvidence || !spec.finalizeEvidence) {
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
  // Review B: recordEvidence が返した output にも write-scope を再適用する（fail-closed）。
  // traversal / 絶対 path / production / 許可外 automation-control が混ざったら PASS にしない。
  const evidenceScope = checkWriteScope(evidenceOutputs, ctx.writeAllowlist);
  if (!evidenceScope.ok) return failed(base, "BLOCKED", ["EVIDENCE_WRITE_SCOPE_VIOLATION", ...evidenceScope.violations], base.summary, evidenceOutputs);

  lifecycle.push("finalizeEvidence");
  const finalized = spec.finalizeEvidence(ctx, { ...artifact, digest, summary: base.summary }, evidenceOutputs);
  if (!finalized.ok) return failed(base, "FAILED", ["EVIDENCE_FINALIZE_FAILED", ...finalized.errors], base.summary, evidenceOutputs);
  const finalOutputs = finalized.outputs ?? evidenceOutputs;
  // Review B: finalizeEvidence が返した output にも write-scope を再適用する（fail-closed）。
  const finalScope = checkWriteScope(finalOutputs, ctx.writeAllowlist);
  if (!finalScope.ok) return failed(base, "BLOCKED", ["FINALIZE_WRITE_SCOPE_VIOLATION", ...finalScope.violations], base.summary, finalOutputs);

  return { ...base, result: "PASS", outputs: finalOutputs };
}
