import {
  OWNER_DASHBOARD_SCHEMA_VERSION,
  validateOwnerDashboardSnapshot,
  type OwnerDashboardSnapshot,
  type OwnerGitCleanliness,
  type OwnerOverallStatus,
} from "./ownerDashboardSnapshot";
import { unavailableBuyLearningSummary, validateBuyLearningSummary, type BuyLearningSummary } from "./buyLearningSummary";

export type OwnerDashboardBuilderInput = {
  generatedAt: string;
  canonicalBranch: string;
  mainSha: string;
  ciStatus: "PASS" | "FAIL" | "PENDING" | "NOT_AVAILABLE";
  openPrCount: number;
  gitCleanliness: OwnerGitCleanliness;
  gitUpdatedAt: string;
  queueState: unknown;
  taskCatalog: unknown;
  currentRun: unknown;
  recentCommits?: unknown;
  buyLearning?: unknown;
};

type CatalogTask = { taskId: string; title: string };
type QueueTask = { status: string; attemptCount: number; maxAttempts: number };

export function buildOwnerDashboardSnapshot(input: OwnerDashboardBuilderInput): OwnerDashboardSnapshot {
  const catalog = parseCatalog(input.taskCatalog);
  const queue = parseQueue(input.queueState);
  const currentRun = parseCurrentRun(input.currentRun);
  const buyLearning = parseBuyLearning(input.buyLearning, input.generatedAt);
  const n2Tasks = [...queue.entries()]
    .filter(([taskId]) => taskId.startsWith("TASK-N2-"))
    .map(([taskId, state]) => ({ taskId, label: catalog.get(taskId)?.title ?? taskId, status: state.status, attemptCount: state.attemptCount, maxAttempts: state.maxAttempts }))
    .sort((a, b) => a.taskId.localeCompare(b.taskId));

  const blockers = n2Tasks
    .filter((task) => task.status.startsWith("BLOCKED") || task.status === "ENGINEERING_REQUIRED" || task.status === "FAILED")
    .map((task) => `${task.taskId}: ${friendlyStatus(task.status)}`);
  for (const block of currentRun.blocks) if (!blockers.includes(block)) blockers.push(block);

  const progress = parseRecentCommits(input.recentCommits);
  const latestProgress = progress[0] ?? null;
  const currentRunMs = currentRun.updatedAt ? Date.parse(currentRun.updatedAt) : Number.NEGATIVE_INFINITY;
  const progressMs = latestProgress ? Date.parse(latestProgress.committedAt) : Number.NEGATIVE_INFINITY;
  const latestObservedAt = progressMs > currentRunMs ? latestProgress!.committedAt : currentRun.updatedAt;
  const changedSummary = progressMs > currentRunMs
    ? latestProgress!.summary
    : currentRun.lastTaskId
      ? `${currentRun.lastTaskId} を ${currentRun.taskStatus ?? currentRun.lastResult} で完了`
      : "実行情報はまだ公開snapshotにありません";
  const lastResult = progressMs > currentRunMs
    ? (input.ciStatus === "PASS" ? "MAIN UPDATED / CI PASS" : "MAIN UPDATED")
    : currentRun.lastResult;
  const nextSafeAction = currentRun.nextCandidate ?? inferNextAction(n2Tasks, buyLearning);
  const overall = deriveOverall({ ciStatus: input.ciStatus, blockers, lastResult: currentRun.lastResult, buyLearning });

  const snapshot: OwnerDashboardSnapshot = {
    schemaVersion: OWNER_DASHBOARD_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    overall,
    git: {
      canonicalBranch: input.canonicalBranch,
      mainSha: input.mainSha,
      ciStatus: input.ciStatus,
      openPrCount: input.openPrCount,
      cleanliness: input.gitCleanliness,
      updatedAt: input.gitUpdatedAt,
    },
    hourlyResearch: {
      lastRunAt: latestObservedAt,
      lastResult,
      changedSummary,
      blocker: currentRun.blocks[0] ?? blockers[0] ?? null,
      nextSafeAction,
    },
    buyLearning,
    n2Tasks,
    recentProgress: progress,
    blockers,
    nextSafeAction,
  };

  const errors = validateOwnerDashboardSnapshot(snapshot);
  if (errors.length) throw new Error(`owner dashboard snapshot invalid: ${errors.join("; ")}`);
  return snapshot;
}

function deriveOverall(input: { ciStatus: OwnerDashboardBuilderInput["ciStatus"]; blockers: string[]; lastResult: string; buyLearning: BuyLearningSummary }): { status: OwnerOverallStatus; reason: string } {
  if (input.ciStatus === "FAIL" || input.lastResult === "FAILED") return { status: "BLOCKED", reason: "CIまたは直近Research実行に失敗があります" };
  if (input.blockers.length > 0 || input.ciStatus === "PENDING" || input.ciStatus === "NOT_AVAILABLE") return { status: "ATTENTION", reason: input.blockers.length ? `${input.blockers.length}件のResearch blockerがあります` : "CI状態の確認が必要です" };
  if (input.buyLearning.status === "AVAILABLE" && input.buyLearning.learnings.some((item) => item.severity === "ACTION")) return { status: "ATTENTION", reason: "BUY outcomeから改善研究候補が検出されています（production自動変更なし）" };
  return { status: "HEALTHY", reason: "既知の停止要因はなく、read-only監視範囲は正常です" };
}

function parseBuyLearning(value: unknown, generatedAt: string): BuyLearningSummary {
  if (value === undefined || value === null) return unavailableBuyLearningSummary(generatedAt);
  const errors = validateBuyLearningSummary(value);
  return errors.length ? unavailableBuyLearningSummary(generatedAt) : value as BuyLearningSummary;
}

function parseCatalog(value: unknown): Map<string, CatalogTask> {
  const result = new Map<string, CatalogTask>();
  if (!isRecord(value) || !Array.isArray(value.tasks)) return result;
  for (const raw of value.tasks) {
    if (!isRecord(raw) || typeof raw.taskId !== "string" || typeof raw.title !== "string") continue;
    result.set(raw.taskId, { taskId: raw.taskId, title: raw.title });
  }
  return result;
}

function parseQueue(value: unknown): Map<string, QueueTask> {
  const result = new Map<string, QueueTask>();
  if (!isRecord(value) || !isRecord(value.tasks)) return result;
  for (const [taskId, raw] of Object.entries(value.tasks)) {
    if (!isRecord(raw) || typeof raw.status !== "string") continue;
    const attemptCount = integer(raw.attemptCount);
    const maxAttempts = integer(raw.maxAttempts);
    if (attemptCount === null || maxAttempts === null) continue;
    result.set(taskId, { status: raw.status, attemptCount, maxAttempts });
  }
  return result;
}

function parseCurrentRun(value: unknown) {
  if (!isRecord(value)) return { updatedAt: null as string | null, lastResult: "NOT_AVAILABLE", lastTaskId: null as string | null, taskStatus: null as string | null, blocks: [] as string[], nextCandidate: null as string | null };
  return {
    updatedAt: typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : null,
    lastResult: typeof value.lastResult === "string" ? value.lastResult : "NOT_AVAILABLE",
    lastTaskId: typeof value.lastTaskId === "string" ? value.lastTaskId : null,
    taskStatus: typeof value.taskStatus === "string" ? value.taskStatus : null,
    blocks: Array.isArray(value.blocks) ? value.blocks.filter((item): item is string => typeof item === "string" && safeText(item)).slice(0, 5) : [],
    nextCandidate: typeof value.nextCandidate === "string" && safeText(value.nextCandidate) ? value.nextCandidate : null,
  };
}

function parseRecentCommits(value: unknown): OwnerDashboardSnapshot["recentProgress"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const sha = typeof raw.sha === "string" && /^[a-f0-9]{7,40}$/.test(raw.sha) ? raw.sha.slice(0, 8) : null;
    const message = typeof raw.message === "string" ? raw.message.split("\n")[0] : null;
    const committedAt = typeof raw.committedAt === "string" && Number.isFinite(Date.parse(raw.committedAt)) ? raw.committedAt : null;
    if (!sha || !message || !committedAt || !safeText(message)) return [];
    return [{ title: humanizeCommit(message), summary: summarizeCommit(message), sha, committedAt }];
  }).slice(0, 5);
}

function inferNextAction(tasks: OwnerDashboardSnapshot["n2Tasks"], buyLearning: BuyLearningSummary): string | null {
  const buyCandidate = buyLearning.researchCandidates[0];
  if (buyCandidate) return `${buyCandidate.id}: ${buyCandidate.title} をread-only researchで検証（production自動変更なし）`;
  const ready = tasks.find((task) => task.status === "READY");
  if (ready) return `${ready.taskId} を安全境界内で次候補として確認`;
  const engineering = tasks.find((task) => task.status.startsWith("BLOCKED_EXECUTOR") || task.status === "ENGINEERING_REQUIRED");
  return engineering ? `${engineering.taskId} のexecutor/read-only実装を整備（自動activateしない）` : null;
}

function friendlyStatus(status: string): string { return status.startsWith("BLOCKED_EXECUTOR") ? "executor未実装" : status; }
function humanizeCommit(message: string): string { return message.replace(/^(fix|feat|research|test)(\([^)]*\))?:\s*/i, "").replace(/\s*\(#\d+\)$/, ""); }
function summarizeCommit(message: string): string { return humanizeCommit(message); }
function integer(value: unknown): number | null { return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeText(value: string): boolean { return value.trim().length > 0 && value.length <= 500 && !/(?:\/Users\/|\/home\/|gh[opusr]_|github_pat_|currentOdds|requiredOdds|recommendedAmount|stake|selection|app_settings|automation\/requests)/i.test(value); }
