import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";
import {
  parseRuleCandidateAppendOptions,
  type RuleCandidateAppendOptions,
} from "../src/research-replay/ruleCandidateAppendOptions";

type QualityReport = {
  generatedAt?: string;
  from?: string;
  to?: string;
  summary?: {
    buy?: number;
    settledBuy?: number;
    hits?: number;
    roi?: number | null;
  };
  ruleSuggestions?: string[];
};

const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  printUsage();
  process.exit(0);
}
const args = parseRuleCandidateAppendOptions(rawArgs);
const input = args.input
  ? readFileSync(
      assertCanonicalSingleLinkRegularFile(
        args.input,
        "rule-candidate append input",
      ),
      "utf-8",
    )
  : readFileSync(0, "utf-8");
const report = JSON.parse(input) as QualityReport;

if (!Array.isArray(report.ruleSuggestions) || report.ruleSuggestions.length === 0) {
  console.log("No rule suggestions found.");
  process.exit(0);
}

const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const appendId = buildAppendId(report, args);
const marker = `<!-- boat-pon-rule-candidate:${appendId} -->`;
const block = buildCandidateBlock(today, report, args, marker);
const appended = withOutputLock(args.output, () => {
  const current = existsSync(args.output)
    ? readFileSync(
        assertCanonicalSingleLinkRegularFile(
          args.output,
          "rule-candidate append output",
        ),
        "utf-8",
      )
    : null;

  if (current?.includes(marker)) return false;

  verifyExistingOutput(args.output);
  return atomicPublish(
    args.output,
    `${(current ?? "").trimEnd()}\n${block}\n`,
    current,
    marker,
  );
});

if (appended) {
  console.log(`Appended ${report.ruleSuggestions.length} rule suggestions to ${args.output}`);
} else {
  console.log("Rule suggestions already appended; no change.");
}

function buildAppendId(report: QualityReport, args: RuleCandidateAppendOptions): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        from: report.from ?? null,
        to: report.to ?? null,
        summary: report.summary ?? null,
        ruleSuggestions: report.ruleSuggestions ?? [],
        status: args.status,
        evidence: args.evidence,
        action: args.action,
        nextCheck: args.nextCheck,
      }),
    )
    .digest("hex");
}

function buildCandidateBlock(
  today: string,
  report: QualityReport,
  args: RuleCandidateAppendOptions,
  marker: string,
) {
  return [
    "",
    marker,
    `## ${today} auto candidate review`,
    "",
    "### Source",
    "",
    `- period: ${report.from ?? "-"}..${report.to ?? "-"}`,
    `- generatedAt: ${report.generatedAt ?? "-"}`,
    `- BUY: ${report.summary?.buy ?? "-"}`,
    `- settledBUY: ${report.summary?.settledBuy ?? "-"}`,
    `- hits: ${report.summary?.hits ?? "-"}`,
    `- ROI: ${formatNumber(report.summary?.roi ?? null)}`,
    "",
    "### Rule suggestions",
    "",
    "| rule | status | evidence | action | next_check |",
    "|---|---|---|---|---|",
    ...(report.ruleSuggestions ?? []).map((suggestion) =>
      `| ${escapeTable(suggestion)} | ${escapeTable(args.status)} | ${escapeTable(args.evidence)} | ${escapeTable(args.action)} | ${escapeTable(args.nextCheck)} |`,
    ),
    "",
  ].join("\n");
}

function assertCanonicalDirectory(path: string, code: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(code);
  return resolvedPath;
}

function withOutputLock<T>(path: string, operation: () => T): T {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, "RULE_CANDIDATE_APPEND_PARENT_IDENTITY_INVALID");
  const lockPath = `${path}.lock`;
  let lockFd: number | null = null;
  let lockAcquired = false;
  try {
    lockFd = openSync(lockPath, "wx", 0o600);
    lockAcquired = true;
    closeSync(lockFd);
    lockFd = null;
    assertCanonicalSingleLinkRegularFile(
      lockPath,
      "RULE_CANDIDATE_APPEND_LOCK_IDENTITY_INVALID",
    );
    return operation();
  } finally {
    if (lockFd !== null) closeSync(lockFd);
    if (lockAcquired) rmSync(lockPath, { force: true });
  }
}

function verifyExistingOutput(path: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, "rule-candidate append output");
}

function atomicPublish(
  path: string,
  content: string,
  expectedCurrent: string | null,
  marker: string,
): boolean {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, "RULE_CANDIDATE_APPEND_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      "rule-candidate append temporary output",
    );

    const destinationExists = existsSync(path);
    if (expectedCurrent === null && destinationExists) {
      const verifiedPath = assertCanonicalSingleLinkRegularFile(
        path,
        "rule-candidate append output",
      );
      const latest = readFileSync(verifiedPath, "utf-8");
      if (latest.includes(marker)) return false;
      throw new Error("RULE_CANDIDATE_APPEND_CONCURRENT_MODIFICATION");
    }
    if (expectedCurrent !== null && !destinationExists) {
      throw new Error("RULE_CANDIDATE_APPEND_CONCURRENT_MODIFICATION");
    }
    if (expectedCurrent !== null) {
      const verifiedPath = assertCanonicalSingleLinkRegularFile(
        path,
        "rule-candidate append output",
      );
      const latest = readFileSync(verifiedPath, "utf-8");
      if (latest !== expectedCurrent) {
        if (latest.includes(marker)) return false;
        throw new Error("RULE_CANDIDATE_APPEND_CONCURRENT_MODIFICATION");
      }
    }

    assertCanonicalDirectory(parentPath, "RULE_CANDIDATE_APPEND_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
    renameSync(verifiedTempPath, path);
    return true;
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function formatNumber(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function escapeTable(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function printUsage() {
  console.log(`Usage:
  npm run append:rule-candidates -- --input /tmp/boat-quality.json
  npm run report:quality -- --json | npm run append:rule-candidates --

Options:
  --input PATH       Read report JSON from file. Defaults to stdin.
  --output PATH      Markdown file to append to. Default: docs/rule-candidates.md
  --status VALUE     Candidate status: watch|candidate|reject|adopted|reverted. Default: watch
  --evidence VALUE   Evidence label. Default: report:quality
  --action VALUE     Action text. Default: 追加観察
  --next-check VALUE Next check text. Default: next weekly`);
}
