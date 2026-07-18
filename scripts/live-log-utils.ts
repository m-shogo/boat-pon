import { existsSync, readFileSync, statSync } from "node:fs";

const KNOWN_REPAIRED_PARSE_FAILURES = new Set([
  "parse-failed: 20260526-大村-02 1-2-3",
  "parse-failed: 20260526-江戸川-11 1-2-3",
  "parse-failed: 20260526-浜名湖-11 1-2-3",
  "parse-failed: 20260526-蒲郡-02 1-2-3",
  "parse-failed: 20260527-江戸川-07 1-2-3",
]);

const SPAWN_UNAR_ENOENT_PATTERN = /^parse failed \d{4}-\d{2}-\d{2}: spawn unar ENOENT$/;

const KNOWN_REPAIRED_SUMMARIES = new Set([
  "auto-fetch-odds done: fetched=2 skipped=125 failed=4 saved=131 dryRun=false",
  "auto-fetch-odds done: fetched=5 skipped=137 failed=1 saved=66 dryRun=false",
  "auto-fetch-odds done: fetched=6 skipped=136 failed=1 saved=70 dryRun=false",
  "--- done: 1 days / 0 programs / cached=1 / already=0 / failed=1",
]);

export type LiveLogJob = "daily-programs" | "auto-odds" | "auto-exhibition" | "daily-progress" | "daily-results";

export type LiveLogInspection = {
  path: string;
  exists: boolean;
  ok: boolean;
  detail: string;
};

export function inspectLiveLog(path: string, job: LiveLogJob): LiveLogInspection {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      ok: true,
      detail: `not created yet; launchd will create it after ${job} runs`,
    };
  }

  const stat = statSync(path);
  const lines = readLogLines(path);
  const activeIssues = lines.filter((line) => isIssueLine(line) && !isKnownRepairedLine(line) && !isStaleIssueLine(line));
  const repairedIssues = lines.filter(isKnownRepairedLine);
  const suffix =
    activeIssues.length > 0
      ? `, active_issues=${activeIssues.length}, last_issue=${activeIssues.at(-1)}`
      : repairedIssues.length > 0
        ? `, repaired_issues=${repairedIssues.length}`
        : "";

  return {
    path,
    exists: true,
    ok: activeIssues.length === 0,
    detail: `${stat.size} bytes, lines=${lines.length}, last=${formatLiveLogLine(lines.at(-1) ?? "-")}${suffix}`,
  };
}

export function tailLiveLog(path: string, count = 40) {
  return readLogLines(path).slice(-count);
}

export function formatLiveLogLine(line: string) {
  const normalized = stripKnownAnnotation(line);
  if (isKnownRepairedLine(normalized)) return `${normalized} [修正済み既知ログ]`;
  if (isKnownRepairedSummary(normalized)) return `${normalized} [旧parser時の修正済み失敗を含む]`;
  return line;
}

function readLogLines(path: string) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trimEnd().split("\n").filter(Boolean);
}

function isIssueLine(line: string) {
  return line.startsWith("parse-failed:")
    || line.startsWith("parse failed ")
    || line.startsWith("error:")
    || /\bbeforeinfo-error:/.test(line);
}

function isStaleIssueLine(line: string) {
  const date = extractIssueDate(line);
  return date != null && date < todayJst();
}

function extractIssueDate(line: string) {
  const compact = line.match(/\b(20\d{2})(\d{2})(\d{2})-/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso?.[1] ?? null;
}

function isKnownRepairedLine(line: string) {
  const normalized = stripKnownAnnotation(line);
  return KNOWN_REPAIRED_PARSE_FAILURES.has(normalized) || SPAWN_UNAR_ENOENT_PATTERN.test(normalized);
}

function isKnownRepairedSummary(line: string) {
  return KNOWN_REPAIRED_SUMMARIES.has(line);
}

function stripKnownAnnotation(line: string) {
  return line.replace(/ \[(修正済み既知ログ|旧parser時の修正済み失敗を含む)\]$/, "");
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
