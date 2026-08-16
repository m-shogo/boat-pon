import { validateBuyLearningSummary, type BuyLearningSummary } from "./buyLearningSummary";
import { validateOwnerBuyEvidenceDiagnostics, type OwnerBuyEvidenceDiagnostics } from "./ownerBuyEvidenceDiagnostics";
import { validateOwnerBuyMarketHealth, type OwnerBuyMarketHealth } from "./ownerBuyMarketHealth";

export const OWNER_DASHBOARD_SCHEMA_VERSION = "owner-dashboard-read-model-v4" as const;

export type OwnerOverallStatus = "HEALTHY" | "ATTENTION" | "BLOCKED" | "UNKNOWN";
export type OwnerGitCleanliness = "CLEAN" | "ATTENTION" | "NOT_AVAILABLE";

export type OwnerDashboardSnapshot = {
  schemaVersion: typeof OWNER_DASHBOARD_SCHEMA_VERSION;
  generatedAt: string;
  overall: { status: OwnerOverallStatus; reason: string };
  git: {
    canonicalBranch: string;
    mainSha: string;
    ciStatus: "PASS" | "FAIL" | "PENDING" | "NOT_AVAILABLE";
    openPrCount: number;
    cleanliness: OwnerGitCleanliness;
    updatedAt: string;
  };
  hourlyResearch: {
    lastRunAt: string | null;
    lastResult: string;
    changedSummary: string;
    blocker: string | null;
    nextSafeAction: string | null;
  };
  buyLearning: BuyLearningSummary;
  buyEvidence: OwnerBuyEvidenceDiagnostics;
  buyMarketHealth: OwnerBuyMarketHealth;
  n2Tasks: Array<{ taskId: string; label: string; status: string; attemptCount: number; maxAttempts: number }>;
  recentProgress: Array<{ title: string; summary: string; sha: string; committedAt: string }>;
  blockers: string[];
  nextSafeAction: string | null;
};

const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SECRET_RE = /\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{10,})\b/;
const PRIVATE_PATH_RE = /(?:^|[\s"'])\/(?:Users|home|var|private|Volumes)\//;
const TOP_KEYS = new Set(["schemaVersion", "generatedAt", "overall", "git", "hourlyResearch", "buyLearning", "buyEvidence", "buyMarketHealth", "n2Tasks", "recentProgress", "blockers", "nextSafeAction"]);
const OVERALL_KEYS = new Set(["status", "reason"]);
const GIT_KEYS = new Set(["canonicalBranch", "mainSha", "ciStatus", "openPrCount", "cleanliness", "updatedAt"]);
const HOURLY_KEYS = new Set(["lastRunAt", "lastResult", "changedSummary", "blocker", "nextSafeAction"]);
const TASK_KEYS = new Set(["taskId", "label", "status", "attemptCount", "maxAttempts"]);
const PROGRESS_KEYS = new Set(["title", "summary", "sha", "committedAt"]);

export function validateOwnerDashboardSnapshot(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["snapshot must be an object"];
  exactKeys(value, TOP_KEYS, "$", errors);
  if (value.schemaVersion !== OWNER_DASHBOARD_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!isIso(value.generatedAt)) errors.push("invalid generatedAt");

  if (!isRecord(value.overall)) errors.push("invalid overall");
  else {
    exactKeys(value.overall, OVERALL_KEYS, "$.overall", errors);
    if (!["HEALTHY", "ATTENTION", "BLOCKED", "UNKNOWN"].includes(String(value.overall.status)) || !isText(value.overall.reason)) errors.push("invalid overall");
  }
  if (!isRecord(value.git)) errors.push("invalid git");
  else {
    exactKeys(value.git, GIT_KEYS, "$.git", errors);
    if (!isText(value.git.canonicalBranch) || !isSha(value.git.mainSha) || !isIso(value.git.updatedAt)) errors.push("invalid git identity");
    if (!["PASS", "FAIL", "PENDING", "NOT_AVAILABLE"].includes(String(value.git.ciStatus))) errors.push("invalid ciStatus");
    if (!isCount(value.git.openPrCount)) errors.push("invalid openPrCount");
    if (!["CLEAN", "ATTENTION", "NOT_AVAILABLE"].includes(String(value.git.cleanliness))) errors.push("invalid cleanliness");
  }
  if (!isRecord(value.hourlyResearch)) errors.push("invalid hourlyResearch");
  else {
    exactKeys(value.hourlyResearch, HOURLY_KEYS, "$.hourlyResearch", errors);
    if (!(value.hourlyResearch.lastRunAt === null || isIso(value.hourlyResearch.lastRunAt))) errors.push("invalid hourly lastRunAt");
    if (!isText(value.hourlyResearch.lastResult) || !isText(value.hourlyResearch.changedSummary)) errors.push("invalid hourly summary");
    if (!(value.hourlyResearch.blocker === null || isText(value.hourlyResearch.blocker))) errors.push("invalid hourly blocker");
    if (!(value.hourlyResearch.nextSafeAction === null || isText(value.hourlyResearch.nextSafeAction))) errors.push("invalid hourly nextSafeAction");
  }
  const buyLearningErrors = validateBuyLearningSummary(value.buyLearning);
  errors.push(...buyLearningErrors.map((error) => `$.buyLearning: ${error}`));
  const buyEvidenceErrors = validateOwnerBuyEvidenceDiagnostics(value.buyEvidence);
  errors.push(...buyEvidenceErrors.map((error) => `$.buyEvidence: ${error}`));
  const buyMarketHealthErrors = validateOwnerBuyMarketHealth(value.buyMarketHealth);
  errors.push(...buyMarketHealthErrors.map((error) => `$.buyMarketHealth: ${error}`));

  if (!Array.isArray(value.n2Tasks) || value.n2Tasks.length > 100) errors.push("invalid n2Tasks");
  else value.n2Tasks.forEach((task, index) => {
    if (!isRecord(task)) return errors.push(`invalid n2 task ${index}`), undefined;
    exactKeys(task, TASK_KEYS, `$.n2Tasks[${index}]`, errors);
    if (!isText(task.taskId) || !isText(task.label) || !isText(task.status) || !isCount(task.attemptCount) || !isCount(task.maxAttempts)) errors.push(`invalid n2 task ${index}`);
  });
  if (!Array.isArray(value.recentProgress) || value.recentProgress.length > 8) errors.push("invalid recentProgress");
  else value.recentProgress.forEach((item, index) => {
    if (!isRecord(item)) return errors.push(`invalid progress ${index}`), undefined;
    exactKeys(item, PROGRESS_KEYS, `$.recentProgress[${index}]`, errors);
    if (!isText(item.title) || !isText(item.summary) || !isShortSha(item.sha) || !isIso(item.committedAt)) errors.push(`invalid progress ${index}`);
  });
  if (!Array.isArray(value.blockers) || !value.blockers.every(isText)) errors.push("invalid blockers");
  if (!(value.nextSafeAction === null || isText(value.nextSafeAction))) errors.push("invalid nextSafeAction");

  const serialized = JSON.stringify(value);
  if (SECRET_RE.test(serialized)) errors.push("secret-like value forbidden");
  if (PRIVATE_PATH_RE.test(serialized)) errors.push("private path forbidden");
  for (const marker of ["currentOdds", "requiredOdds", "recommendedAmount", "stake", "selection", "raceId", "decisionId", "segmentKey", "app_settings", "automation/requests", "holdoutRawKey"]) {
    if (serialized.toLowerCase().includes(marker.toLowerCase())) errors.push(`private marker forbidden: ${marker}`);
  }
  return errors;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}: unknown key`);
  for (const key of allowed) if (!(key in value)) errors.push(`${path}.${key}: required`);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 500; }
function isCount(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function isIso(value: unknown): value is string { return typeof value === "string" && RFC3339_TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value)); }
function isSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function isShortSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{7,12}$/.test(value); }
