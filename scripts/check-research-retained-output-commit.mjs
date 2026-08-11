import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RETAINED_PREFIX = "reports/automation/retained-outputs/";
const HISTORY_PREFIX = "reports/automation/history/";
const RUN_ID_RE = /^[0-9A-Za-z._-]+$/u;
const HISTORY_RE = /^reports\/automation\/history\/([0-9A-Za-z._-]+)-TASK-[0-9A-Za-z._-]+\.json$/u;
const RETAINED_RE = /^reports\/automation\/retained-outputs\/([0-9A-Za-z._-]+)\/[^/]+$/u;
const TRUSTED_GIT_BIN = process.env.TRUSTED_GIT_BIN ?? "";

if (!TRUSTED_GIT_BIN.startsWith("/")) {
  throw new Error("RETAINED_COMMIT_TRUSTED_GIT_INVALID");
}

function argument(name) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function gitLines(args) {
  const output = execFileSync(TRUSTED_GIT_BIN, ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
    encoding: "utf8",
  });
  return output.split("\n").map((value) => value.trim()).filter(Boolean);
}

function validateRetainedOutputCommit(input) {
  const changed = [...new Set(input.changedPaths.filter(Boolean))];
  const retained = changed.filter((path) => path.startsWith(RETAINED_PREFIX));
  const histories = changed.filter((path) => path.startsWith(HISTORY_PREFIX));

  const expectedRunId = input.expectedRunId?.trim() || null;
  if (expectedRunId != null && expectedRunId !== "local" && !RUN_ID_RE.test(expectedRunId)) {
    throw new Error("RETAINED_COMMIT_EXPECTED_RUN_ID_INVALID");
  }

  const parsedHistories = new Map();
  for (const historyPath of histories) {
    const historyMatch = historyPath.match(HISTORY_RE);
    if (!historyMatch) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PATH_INVALID:${historyPath}`);
    }
    const pathRunId = historyMatch[1] ?? "";
    let history;
    try {
      const parsed = JSON.parse(input.readText(historyPath));
      if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) throw new Error("not object");
      history = parsed;
    } catch {
      throw new Error(`RETAINED_COMMIT_HISTORY_JSON_INVALID:${historyPath}`);
    }
    if (String(history.runId ?? "") !== pathRunId) {
      throw new Error(`RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:${historyPath}`);
    }
    if (!Array.isArray(history.outputs) || history.outputs.some((value) => typeof value !== "string")) {
      throw new Error(`RETAINED_COMMIT_HISTORY_OUTPUTS_INVALID:${historyPath}`);
    }
    const outputs = history.outputs;
    for (const output of outputs) {
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

  const retainedByRun = new Map();
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

const repoRoot = resolve(process.cwd());
const relevantRoots = ["reports/automation/retained-outputs", "reports/automation/history"];
const changedPaths = [...new Set([
  ...gitLines(["diff", "--no-ext-diff", "--name-only", "--", ...relevantRoots]),
  ...gitLines(["diff", "--cached", "--no-ext-diff", "--name-only", "--", ...relevantRoots]),
  ...gitLines(["ls-files", "--others", "--exclude-standard", "--", ...relevantRoots]),
])].sort();

const result = validateRetainedOutputCommit({
  changedPaths,
  expectedRunId: argument("run-id"),
  readText: (relativePath) => readFileSync(resolve(repoRoot, relativePath), "utf8"),
});

console.log(JSON.stringify({
  gateVersion: "research-retained-output-commit-gate-v1",
  ...result,
  currentBuyConnectionAuthorized: false,
  lineConnectionAuthorized: false,
  databaseWriteAuthorized: false,
  publicPublishAuthorized: false,
  automatedBettingAuthorized: false,
  productionApplyAuthorized: false,
}, null, 2));