// boat-pon 自動運転前 readiness 判定（純ロジック層）。
// スケジュール再有効化前に、機械的に PASS/CONDITIONAL/BLOCKED を判定するための分類器。
// production / DB / sidecar に触れない純関数。
import { createHash } from "node:crypto";

export const READINESS_SCHEMA_VERSION = "pre-schedule-readiness-v1";

export type CheckStatus = "PASS" | "CONDITIONAL" | "BLOCKED" | "NOT_APPLICABLE" | "NOT_RUN";
export type Severity = "P0" | "P1" | "P2";
export type ReadinessCheck = { name: string; status: CheckStatus; severity: Severity; detail?: string };

// ---- disk 分類（warning / critical を設定化）----
export type DiskThresholds = {
  warningFreeBytes: number; warningFreeRatio: number;
  criticalFreeBytes: number; criticalFreeRatio: number;
};
export const DEFAULT_DISK_THRESHOLDS: DiskThresholds = {
  warningFreeBytes: 20 * 1024 ** 3, warningFreeRatio: 0.15,
  criticalFreeBytes: 10 * 1024 ** 3, criticalFreeRatio: 0.08,
};
export function classifyDisk(freeBytes: number, totalBytes: number, t: DiskThresholds = DEFAULT_DISK_THRESHOLDS):
  { level: "ok" | "warning" | "critical"; startAllowed: boolean; freeRatio: number } {
  const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0;
  if (freeBytes < t.criticalFreeBytes || freeRatio < t.criticalFreeRatio) return { level: "critical", startAllowed: false, freeRatio };
  if (freeBytes < t.warningFreeBytes || freeRatio < t.warningFreeRatio) return { level: "warning", startAllowed: true, freeRatio };
  return { level: "ok", startAllowed: true, freeRatio };
}

// ---- failure budget / signature ----
// 同一 task + 同一 failure signature が連続 limit 回で自動 retry を止める。
export function failureSignature(taskId: string, blocks: string[]): string {
  return createHash("sha256").update(`${taskId}|${[...blocks].sort().join(",")}`).digest("hex").slice(0, 16);
}
export function shouldStopAutoRetry(
  recent: Array<{ taskId: string; signature: string }>, taskId: string, signature: string, limit = 2,
): boolean {
  // 直近の連続する同 task+signature の回数（今回分を含む）。
  let consecutive = 1;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (recent[i].taskId === taskId && recent[i].signature === signature) consecutive += 1;
    else if (recent[i].taskId === taskId) break; // 同 task の別 signature が挟まれたら連続打ち切り
  }
  return consecutive >= limit;
}

// failure code → 取るべき action。自動運転の failure budget 正式ルール。
export type FailureAction = "RETRY_BACKOFF" | "ENGINEERING_REQUIRED" | "BLOCKED_TERMINAL" | "BLOCKED_RESOURCE" | "WAIT_NEW_INTENT" | "NO_RETRY";
export function classifyFailureAction(code: string): FailureAction {
  if (/EXECUTOR_NOT_IMPLEMENTED|EXECUTOR_NOT_REGISTERED|ENGINEERING_REQUIRED/.test(code)) return "ENGINEERING_REQUIRED";
  if (/DATASET_CONTRACT|DATA_CONTRACT|SIDECAR_SCHEMA/.test(code)) return "ENGINEERING_REQUIRED";
  if (/PIT_OR_LEAKAGE|HOLDOUT|LEAKAGE/.test(code)) return "BLOCKED_TERMINAL";
  if (/INSUFFICIENT_DISK|DISK_CRITICAL|ACTIVE_WAL|INSUFFICIENT_RESOURCE/.test(code)) return "BLOCKED_RESOURCE";
  if (/AUTHORITY_SHA_MISMATCH|STALE_AUTHORITY|QUEUE_DIGEST_MISMATCH/.test(code)) return "WAIT_NEW_INTENT";
  if (/NETWORK|TIMEOUT|TRANSIENT|RATE_LIMIT|GITHUB_5\d\d/.test(code)) return "RETRY_BACKOFF";
  return "NO_RETRY";
}
// preflight failure が executor attempt を消費するか（消費しない = attempt 前に BLOCK）。
export const PREFLIGHT_FAILURE_CONSUMES_ATTEMPT = false;

// ---- verdict 集約 ----
export type ReadinessVerdict = { verdict: "PASS" | "CONDITIONAL" | "BLOCKED"; unresolvedBlockers: ReadinessCheck[] };
export function computeVerdict(checks: ReadinessCheck[]): ReadinessVerdict {
  const blockedP0P1 = checks.filter((c) => c.status === "BLOCKED" && (c.severity === "P0" || c.severity === "P1"));
  const conditional = checks.filter((c) => c.status === "CONDITIONAL" || (c.status === "BLOCKED" && c.severity === "P2"));
  const notRun = checks.filter((c) => c.status === "NOT_RUN");
  // 未実行があれば PASS にしない（CONDITIONAL 以下）。
  if (blockedP0P1.length > 0) return { verdict: "BLOCKED", unresolvedBlockers: blockedP0P1 };
  if (conditional.length > 0 || notRun.length > 0) return { verdict: "CONDITIONAL", unresolvedBlockers: [...conditional, ...notRun] };
  return { verdict: "PASS", unresolvedBlockers: [] };
}

// canonical digest（readiness artifact 用。timestamp 等 volatile field を除いて渡す）。
export function readinessDigest(obj: Record<string, unknown>): string {
  const stable = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash("sha256").update(stable).digest("hex");
}
