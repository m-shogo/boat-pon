import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

const RETAINED_PREFIX = "reports/automation/retained-outputs/";
const HISTORY_PREFIX = "reports/automation/history/";
const MAX_HISTORY_BYTES = 8_000_000;
const HISTORY_READ_CHUNK_BYTES = 64 * 1024;
const RUN_ID_RE = /^(?!\.{1,2}$)[0-9A-Za-z._-]+$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const GIT_SHA_RE = /^[0-9a-f]{40}$/u;
const GITHUB_RUN_ID_RE = /^[0-9]+$/u;
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
];
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

function approvedOutputPath(value) {
  if (!value || value.startsWith("/") || value.includes("\0")) return false;
  if (value.startsWith(HISTORY_PREFIX)) return false;
  if (value.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return ALLOWED_OUTPUT_ROOTS.some((root) => value.startsWith(root));
}

function validateRetainedOutputCommit(input) {
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

  const parsedHistories = new Map();
  for (const historyPath of histories) {
    const historyMatch = historyPath.match(HISTORY_RE);
    if (!historyMatch) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PATH_INVALID:${historyPath}`);
    }
    const pathRunId = historyMatch[1] ?? "";
    const pathTaskId = historyMatch[2] ?? "";
    if (!RUN_ID_RE.test(pathRunId)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PATH_INVALID:${historyPath}`);
    }
    if (expectedRunId != null && expectedRunId !== "local" && pathRunId !== expectedRunId) {
      throw new Error(`RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:${pathRunId}!=${expectedRunId}`);
    }
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
    if (String(history.taskId ?? "") !== pathTaskId) {
      throw new Error(`RETAINED_COMMIT_HISTORY_TASK_ID_MISMATCH:${historyPath}`);
    }
    const historyResult = String(history.result ?? "");
    if (!TERMINAL_RESULTS.has(historyResult)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_RESULT_INVALID:${historyPath}:${historyResult || "missing"}`);
    }
    if (!Array.isArray(history.blocks) || history.blocks.some((value) => typeof value !== "string")) {
      throw new Error(`RETAINED_COMMIT_HISTORY_BLOCKS_INVALID:${historyPath}`);
    }
    if (historyResult === "PASS" && history.blocks.length > 0) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PASS_HAS_BLOCKS:${historyPath}`);
    }
    if ((historyResult === "BLOCKED" || historyResult === "FAILED") && history.blocks.length === 0) {
      throw new Error(`RETAINED_COMMIT_HISTORY_NONPASS_BLOCKS_EMPTY:${historyPath}`);
    }
    if (history.executed !== true) {
      throw new Error(`RETAINED_COMMIT_HISTORY_EXECUTED_NOT_TRUE:${historyPath}`);
    }
    if (typeof history.outputDigest !== "string" || !SHA256_RE.test(history.outputDigest)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_OUTPUT_DIGEST_INVALID:${historyPath}`);
    }
    if (typeof history.summary !== "object" || history.summary == null || Array.isArray(history.summary)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_SUMMARY_INVALID:${historyPath}`);
    }
    if (typeof history.idempotencyKey !== "string" || !SHA256_RE.test(history.idempotencyKey)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_IDEMPOTENCY_KEY_INVALID:${historyPath}`);
    }
    if (typeof history.authoritySha !== "string" || !GIT_SHA_RE.test(history.authoritySha)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_AUTHORITY_SHA_INVALID:${historyPath}`);
    }
    if (!Array.isArray(history.outputs) || history.outputs.some((value) => typeof value !== "string")) {
      throw new Error(`RETAINED_COMMIT_HISTORY_OUTPUTS_INVALID:${historyPath}`);
    }
    const outputs = history.outputs;
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
      if (!RUN_ID_RE.test(outputRunId)) {
        throw new Error(`RETAINED_COMMIT_HISTORY_RETAINED_PATH_INVALID:${historyPath}:${output}`);
      }
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
    if (!RUN_ID_RE.test(runId)) throw new Error(`RETAINED_COMMIT_PATH_INVALID:${path}`);
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

function assertHistoryParentDirectories(repoRoot, relativePath) {
  const absolutePath = resolve(repoRoot, relativePath);
  if (absolutePath !== repoRoot && !absolutePath.startsWith(`${repoRoot}${sep}`)) {
    throw new Error(`RETAINED_COMMIT_HISTORY_PATH_ESCAPES_ROOT:${relativePath}`);
  }
  let cursor = dirname(absolutePath);
  while (cursor !== repoRoot) {
    if (!cursor.startsWith(`${repoRoot}${sep}`)) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PATH_ESCAPES_ROOT:${relativePath}`);
    }
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PARENT_INVALID:${relativePath}`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error(`RETAINED_COMMIT_HISTORY_PATH_ESCAPES_ROOT:${relativePath}`);
    }
    cursor = parent;
  }
  return absolutePath;
}

function readValidatedHistoryText(repoRoot, relativePath) {
  const absolutePath = assertHistoryParentDirectories(repoRoot, relativePath);
  const expectedStat = lstatSync(absolutePath);
  if (expectedStat.isSymbolicLink() || !expectedStat.isFile() || expectedStat.nlink !== 1) {
    throw new Error(`RETAINED_COMMIT_HISTORY_FILE_TYPE_INVALID:${relativePath}`);
  }
  if (expectedStat.size > MAX_HISTORY_BYTES) {
    throw new Error(`RETAINED_COMMIT_HISTORY_SIZE_INVALID:${relativePath}`);
  }

  let fd = null;
  try {
    fd = openSync(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (
      !stat.isFile()
      || stat.nlink !== 1
      || stat.dev !== expectedStat.dev
      || stat.ino !== expectedStat.ino
      || stat.size !== expectedStat.size
    ) {
      throw new Error(`RETAINED_COMMIT_HISTORY_FILE_CHANGED_DURING_READ:${relativePath}`);
    }
    if (stat.size > MAX_HISTORY_BYTES) {
      throw new Error(`RETAINED_COMMIT_HISTORY_SIZE_INVALID:${relativePath}`);
    }

    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithSentinel = MAX_HISTORY_BYTES - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(HISTORY_READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_HISTORY_BYTES) {
        throw new Error(`RETAINED_COMMIT_HISTORY_SIZE_INVALID:${relativePath}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (totalBytes !== stat.size) {
      throw new Error(`RETAINED_COMMIT_HISTORY_FILE_CHANGED_DURING_READ:${relativePath}`);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, totalBytes));
    } catch {
      throw new Error(`RETAINED_COMMIT_HISTORY_UTF8_INVALID:${relativePath}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ELOOP")) {
      throw new Error(`RETAINED_COMMIT_HISTORY_FILE_TYPE_INVALID:${relativePath}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

const requestedRunId = argument("run-id");
if (process.env.GITHUB_ACTIONS === "true") {
  const githubRunId = (process.env.GITHUB_RUN_ID ?? "").trim();
  if (!GITHUB_RUN_ID_RE.test(githubRunId)) {
    throw new Error("RETAINED_COMMIT_GITHUB_RUN_ID_INVALID");
  }
  if (requestedRunId !== githubRunId) {
    throw new Error(`RETAINED_COMMIT_GITHUB_RUN_ID_MISMATCH:${requestedRunId ?? "missing"}!=${githubRunId}`);
  }
}

const repoRoot = realpathSync(process.cwd());
const gitTopLevels = gitLines(["rev-parse", "--show-toplevel"]);
if (gitTopLevels.length !== 1) {
  throw new Error("RETAINED_COMMIT_WORKTREE_IDENTITY_INVALID");
}
let gitRepoRoot;
try {
  gitRepoRoot = realpathSync(resolve(gitTopLevels[0]));
} catch {
  throw new Error("RETAINED_COMMIT_WORKTREE_IDENTITY_INVALID");
}
if (gitRepoRoot !== repoRoot) {
  throw new Error(`RETAINED_COMMIT_WORKTREE_MISMATCH:${gitRepoRoot}!=${repoRoot}`);
}

const relevantRoots = ["reports/automation/retained-outputs", "reports/automation/history"];
const changedPaths = [...new Set([
  ...gitLines(["diff", "--no-ext-diff", "--name-only", "--", ...relevantRoots]),
  ...gitLines(["diff", "--cached", "--no-ext-diff", "--name-only", "--", ...relevantRoots]),
  ...gitLines(["ls-files", "--others", "--exclude-standard", "--", ...relevantRoots]),
])].sort();

const result = validateRetainedOutputCommit({
  changedPaths,
  expectedRunId: requestedRunId,
  readText: (relativePath) => readValidatedHistoryText(repoRoot, relativePath),
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