import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const input = args.input ? readFileSync(args.input, "utf-8") : readFileSync(0, "utf-8");
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

const block = buildCandidateBlock(today, report, args);
const current = existsSync(args.output) ? readFileSync(args.output, "utf-8") : "";
writeFileSync(args.output, `${current.trimEnd()}\n${block}\n`, "utf-8");

console.log(`Appended ${report.ruleSuggestions.length} rule suggestions to ${args.output}`);

function buildCandidateBlock(today: string, report: QualityReport, args: RuleCandidateAppendOptions) {
  return [
    "",
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