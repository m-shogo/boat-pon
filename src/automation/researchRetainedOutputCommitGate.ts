const RETAINED_PREFIX = "reports/automation/retained-outputs/";
const HISTORY_PREFIX = "reports/automation/history/";
const RUN_ID_RE = /^[0-9A-Za-z._-]+$/u;
const HISTORY_RE = /^reports\/automation\/history\/([0-9A-Za-z._-]+)-(TASK-[0-9A-Za-z._-]+)\.json$/u;
const RETAINED_RE = /^reports\/automation\/retained-outputs\/([0-9A-Za-z._-]+)\/[0-9a-f]{64}-(?!\.{1,2}$)[0-9A-Za-z._-]{1,160}$/u;
const TERMINAL_RESULTS = new Set([
  "PASS",
  "CONDITIONAL",
  "BLOCKED",
  "FAILED",
]);
const ALLOWED_OUTPUT_ROOTS = [
  "reports/n2/",
  "reports/automation/",
  "research/registries/",
  "automation/control/",
] as const;

export type RetainedOutputCommitGateResult = {
  retainedPathCount: number;
  historyPathCount: number;
  referencedRetainedPathCount: number;
  runIds: string[];
};

function approvedOutputPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\0")) return false;
  if (value.startsWith(HISTORY_PREFIX)) return false;
  if (value.split("/").some((part) => part === "..")) return false;
  return ALLOWED_OUTPUT_ROOTS.some((root) => value.startsWith(root));
}

export function validateRetainedOutputCommit(input: {
  changedPaths: string[];
  expectedRunId?: string | null;
  readText: (relativePath: string) => string;
}): RetainedOutputCommitGateResult {
  const changed = [...new Set(input.changedPaths.filter(Boolean))];
  const retained = changed.filter((path) => path.startsWith(RETAINED_PREFIX));
  const histories = changed.filter((path) => path.startsWith(HISTORY_PREFIX));

  const expectedRunId = input.expectedRunId?.trim() || null;
  if (expectedRunId != null && expectedRunId !== "local" && !RUN_ID_RE.test(expectedRunId)) {
    throw new Error("RETAINED_COMMIT_EXPECTED_RUN_ID_INVALID");
  }
  if (expectedRunId != null && expectedRunId !== "local" && histories.length > 1) {
    throw new Error(`RETAINED_COMMIT_HISTORY_COUNT_INVALID:${expectedRunId}:${histories.length}`);
  }

  const parsedHistories = new Map<string, { runId: string; outputs: string[] }>();
  for (const historyPath of histories) {
    const historyMatch = historyPath.match(HISTORY_RE);
    if (!historyMatch) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PATH_INVALID:${historyPath}`);
    }
    const pathRunId = historyMatch[1] ?? "";
    const pathTaskId = historyMatch[2] ?? "";
    if (expectedRunId != null && expectedRunId !== "local" && pathRunId !== expectedRunId) {
      throw new Error(`RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:${pathRunId}!=${expectedRunId}`);
    }
    let history: Record<string, unknown>;
    try {
      const parsed = JSON.parse(input.readText(historyPath)) as unknown;
      if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) throw new Error("not object");
      history = parsed as Record<string, unknown>;
    } catch {
      throw new Error(`RETAINED_COMMIT_HISTORY_JSON_INVALID:${historyPath}`);
    }
    if (String(history.runId ?? "") !== pathRunId) {
      throw new Error(`RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:${historyPath}`);
    }
    if (String(history.taskId ?? "") !== pathTaskId) {
      throw new Error(`RETAINED_COMMIT_HISTORY_TASK_ID_MISMATCH:${historyPath}`);
    }
    const historyResult = String(history.result ?? "");
    if (!TERMINAL_RESULTS.has(historyResult)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_RESULT_INVALID:${historyPath}:${historyResult || "missing"}`);
    }
    if (Array.isArray(history.blocks)) {
      if (historyResult === "PASS" && history.blocks.length > 0) {
        throw new Error(`RETAINED_COMMIT_HISTORY_PASS_HAS_BLOCKS:${historyPath}`);
      }
      if ((historyResult === "BLOCKED" || historyResult === "FAILED") && history.blocks.length === 0) {
        throw new Error(`RETAINED_COMMIT_HISTORY_NONPASS_BLOCKS_EMPTY:${historyPath}`);
      }
    }
    if (!Array.isArray(history.outputs) || history.outputs.some((value) => typeof value !== "string")) {
      throw new Error(`RETAINED_COMMIT_HISTORY_OUTPUTS_INVALID:${historyPath}`);
    }
    const outputs = history.outputs as string[];
    if (new Set(outputs).size !== outputs.length) {
      throw new Error(`RETAINED_COMMIT_HISTORY_OUTPUTS_DUPLICATE:${historyPath}`);
    }
    for (const output of outputs) {
      if (!approvedOutputPath(output)) {
        throw new Error(`RETAINED_COMMIT_HISTORY_OUTPUT_PATH_NOT_APPROVED:${historyPath}:${output}`);
      }
      if (!output.startsWith(RETAINED_PREFIX)) continue;
      const retainedMatch = output.match(RETAINED_RE);
      if (!retainedMatch) {
        throw new Error(`RETAINED_COMMIT_HISTORY_RETAINED_PATH_INVALID:${historyPath}:${output}`);
      }
      const outputRunId = retainedMatch[1] ?? "";
      if (outputRunId !== pathRunId) {
        throw new Error(`RETAINED_COMMIT_HISTORY_RETAINED_RUN_ID_MISMATCH:${historyPath}:${outputRunId}!=${pathRunId}`);
      }
    }
    parsedHistories.set(historyPath, { runId: pathRunId, outputs });
  }

  if (retained.length === 0) {
    return { retainedPathCount: 0, historyPathCount: histories.length, referencedRetainedPathCount: 0, runIds: [] };
  }

  const retainedByRun = new Map<string, string[]>();
  for (const path of retained) {
    const match = path.match(RETAINED_RE);
    if (!match) throw new Error(`RETAINED_COMMIT_PATH_INVALID:${path}`);
    const runId = match[1] ?? "";
    if (expectedRunId != null && expectedRunId !== "local" && runId !== expectedRunId) {
      throw new Error(`RETAINED_COMMIT_RUN_ID_MISMATCH:${runId}!=${expectedRunId}`);
    }
    const list = retainedByRun.get(runId) ?? [];
    list.push(path);
    retainedByRun.set(runId, list);
  }

  let referencedRetainedPathCount = 0;
  for (const [runId, runRetainedPaths] of retainedByRun) {
    const runHistoryPaths = histories.filter((path) => parsedHistories.get(path)?.runId === runId);
    if (runHistoryPaths.length !== 1) {
      throw new Error(`RETAINED_COMMIT_HISTORY_COUNT_INVALID:${runId}:${runHistoryPaths.length}`);
    }
    const historyPath = runHistoryPaths[0] ?? "";
    const outputs = parsedHistories.get(historyPath)?.outputs ?? [];
    const outputSet = new Set(outputs);
    for (const path of runRetainedPaths) {
      if (!outputSet.has(path)) throw new Error(`RETAINED_COMMIT_ORPHAN:${path}`);
      referencedRetainedPathCount += 1;
    }
  }

  return {
    retainedPathCount: retained.length,
    historyPathCount: histories.length,
    referencedRetainedPathCount,
    runIds: [...retainedByRun.keys()].sort(),
  };
}
