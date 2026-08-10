import {
  PUBLIC_SNAPSHOT_SCHEMA_VERSION,
  type PublicDashboardSnapshot,
  type PublicResearchStatus,
} from "./publicSnapshot";
import {
  DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS,
  DEFAULT_PUBLIC_SNAPSHOT_MAX_AGE_MS,
} from "./publicSnapshotTransport";

export type PublicSnapshotBuilderInput = {
  catalog: unknown;
  queueState: unknown;
  currentRun: unknown;
  readiness: unknown;
  generatedAt: string;
  modelVersion: string;
};

type CatalogTask = {
  taskId: string;
  title: string;
  dependencies: string[];
};

type QueueTask = {
  status: string;
  evidenceLinks: string[];
  updatedAt: string | null;
};

const PUBLIC_EVIDENCE_PREFIXES = ["reports/", "research/registries/"] as const;
const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function publicEvidenceArray(value: unknown): string[] {
  return stringArray(value).filter((path) => {
    if (!path || path.startsWith("/") || path.includes("\0")) return false;
    if (path.split("/").some((part) => part === "..")) return false;
    return PUBLIC_EVIDENCE_PREFIXES.some((prefix) => path.startsWith(prefix));
  });
}

function parseCatalog(value: unknown): CatalogTask[] {
  if (!isRecord(value) || !Array.isArray(value.tasks)) return [];
  return value.tasks.flatMap((task) => {
    if (!isRecord(task)) return [];
    const taskId = stringValue(task.taskId);
    const title = stringValue(task.title);
    if (!taskId || !title) return [];
    return [{ taskId, title, dependencies: stringArray(task.dependencies) }];
  });
}

function parseQueue(value: unknown): { updatedAt: string | null; tasks: Map<string, QueueTask> } {
  const tasks = new Map<string, QueueTask>();
  if (!isRecord(value)) return { updatedAt: null, tasks };
  if (isRecord(value.tasks)) {
    for (const [taskId, rawTask] of Object.entries(value.tasks)) {
      if (!isRecord(rawTask)) continue;
      const status = stringValue(rawTask.status);
      if (!status) continue;
      tasks.set(taskId, {
        status,
        evidenceLinks: publicEvidenceArray(rawTask.evidenceLinks),
        updatedAt: stringValue(rawTask.updatedAt),
      });
    }
  }
  return { updatedAt: stringValue(value.updatedAt), tasks };
}

function mapTaskStatus(status: string | null): PublicResearchStatus {
  if (!status) return "NOT_AVAILABLE";
  if (status === "PASS") return "PASS";
  if (status === "READY") return "READY";
  if (status === "CLAIMED" || status === "RUNNING") return "RUNNING";
  if (status.startsWith("BLOCKED_EXECUTOR") || status === "ENGINEERING_REQUIRED") {
    return "ENGINEERING_REQUIRED";
  }
  if (status.startsWith("BLOCKED") || status === "FAILED") return "BLOCKED";
  if (status === "NOT_STARTED") return "NOT_STARTED";
  return "NOT_AVAILABLE";
}

function readinessStatus(value: unknown): PublicResearchStatus {
  if (!isRecord(value)) return "NOT_AVAILABLE";
  const verdict = stringValue(value.verdict);
  if (verdict === "PASS") return "PASS";
  if (verdict === "BLOCKED" || verdict === "FAILED") return "BLOCKED";
  return "NOT_AVAILABLE";
}

function runnerStatus(value: unknown): PublicResearchStatus {
  if (!isRecord(value)) return "NOT_AVAILABLE";
  const result = stringValue(value.lastResult);
  if (result === "PASS") return "PASS";
  if (result === "RUNNING" || result === "CLAIMED") return "RUNNING";
  if (result === "FAILED" || result === "BLOCKED") return "BLOCKED";
  return "NOT_AVAILABLE";
}

function isRfc3339DateTime(value: string): boolean {
  return RFC3339_TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value));
}

function sourceUpdatedAt(value: unknown, maxTimestampMs: number): string | null {
  if (!isRecord(value)) return null;
  const candidate = stringValue(value.updatedAt) ?? stringValue(value.evaluatedAt);
  return candidate
    && isRfc3339DateTime(candidate)
    && Date.parse(candidate) <= maxTimestampMs
    ? candidate
    : null;
}

function latestIso(values: Array<string | null>, fallback: string, maxTimestampMs: number): string {
  const valid = values
    .filter((value): value is string => value !== null
      && isRfc3339DateTime(value)
      && Date.parse(value) <= maxTimestampMs)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return valid[0] ?? fallback;
}

function readinessCheckStatus(value: unknown, checkName: string): PublicResearchStatus {
  if (!isRecord(value) || !Array.isArray(value.checks)) return "NOT_AVAILABLE";
  const check = value.checks.find((item) => isRecord(item) && item.name === checkName);
  if (!isRecord(check)) return "NOT_AVAILABLE";
  return mapTaskStatus(stringValue(check.status));
}

export function buildPublicDashboardSnapshot(
  input: PublicSnapshotBuilderInput,
): PublicDashboardSnapshot {
  const generatedAtMs = Date.parse(input.generatedAt);
  if (!isRfc3339DateTime(input.generatedAt) || !Number.isFinite(generatedAtMs)) {
    throw new Error("generatedAt must be an RFC3339 date-time");
  }
  if (!input.modelVersion.trim() || input.modelVersion.length > 120) {
    throw new Error("modelVersion must have length 1..120");
  }

  const catalog = parseCatalog(input.catalog);
  const queue = parseQueue(input.queueState);
  const pipeline = catalog.map((task) => {
    const queueTask = queue.tasks.get(task.taskId);
    return {
      taskId: task.taskId,
      label: task.title,
      status: mapTaskStatus(queueTask?.status ?? null),
      dependencies: [...task.dependencies],
      evidence: [...(queueTask?.evidenceLinks ?? [])],
    };
  });

  const activeTask = pipeline.find((task) => task.status === "RUNNING")
    ?? pipeline.find((task) => task.status === "READY" && task.taskId !== "TASK-PLANNER-NEXT")
    ?? pipeline.find((task) => task.status === "ENGINEERING_REQUIRED" && task.taskId !== "TASK-PLANNER-NEXT")
    ?? pipeline.find((task) => task.status === "READY")
    ?? null;
  const readinessPending = isRecord(input.readiness) ? stringValue(input.readiness.pendingTask) : null;
  const maxSourceTimestampMs = generatedAtMs + DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS;
  const currentRunAt = sourceUpdatedAt(input.currentRun, maxSourceTimestampMs);
  const dataAsOf = latestIso([
    queue.updatedAt,
    currentRunAt,
    sourceUpdatedAt(input.readiness, maxSourceTimestampMs),
  ], input.generatedAt, maxSourceTimestampMs);
  const dataAsOfMs = Date.parse(dataAsOf);
  const declaredFreshness = generatedAtMs - dataAsOfMs > DEFAULT_PUBLIC_SNAPSHOT_MAX_AGE_MS
    ? "STALE"
    : "FRESH";

  const pitTask = queue.tasks.get("TASK-N2-011");
  const commonCohortTask = queue.tasks.get("TASK-N2-022");

  return {
    schemaVersion: PUBLIC_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    dataAsOf,
    modelVersion: input.modelVersion,
    integrity: {
      algorithm: "sha256",
      digest: "0".repeat(64),
    },
    status: {
      currentPhase: activeTask ? `N2 / ${activeTask.label}` : "N2 research governance",
      readiness: readinessStatus(input.readiness),
      lastRunAt: currentRunAt,
      nextTask: activeTask?.taskId ?? readinessPending,
      runner: runnerStatus(input.currentRun),
      snapshotFreshness: declaredFreshness,
    },
    metrics: [],
    pipeline,
    registries: {
      experiments: null,
      discoveries: null,
      rejections: null,
    },
    dataQuality: {
      coverageStatus: readinessCheckStatus(input.readiness, "n2_001to006_PASS"),
      pitStatus: mapTaskStatus(pitTask?.status ?? null),
      holdoutStatus: readinessCheckStatus(input.readiness, "holdoutFreezePresent"),
      commonCohortStatus: mapTaskStatus(commonCohortTask?.status ?? null),
      notes: [
        "公開snapshotはautomation/task authorityのallowlisted状態だけから生成しています。",
        "正確なBUY候補、selection、stake、odds、内部threshold、holdout raw keyは含みません。",
        "未取得のregistry件数と集計指標は0へ変換せずNOT_AVAILABLEとして扱います。",
      ],
    },
    methodologyReferences: [
      {
        label: "Public / Owner data classification",
        path: "/methodology/public-private-boundary",
      },
      {
        label: "Point-in-time and holdout principles",
        path: "/methodology/research-safety",
      },
    ],
  };
}