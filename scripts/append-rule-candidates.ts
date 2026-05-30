import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

type Args = {
  input: string | null;
  output: string;
  status: string;
  evidence: string;
  action: string;
  nextCheck: string;
};

const args = parseArgs(process.argv.slice(2));
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

function buildCandidateBlock(today: string, report: QualityReport, args: Args) {
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

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    input: null,
    output: "docs/rule-candidates.md",
    status: "watch",
    evidence: "report:quality",
    action: "追加観察",
    nextCheck: "next weekly",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--input") {
      parsed.input = requireValue(key, value);
      i += 1;
    } else if (key === "--output") {
      parsed.output = requireValue(key, value);
      i += 1;
    } else if (key === "--status") {
      parsed.status = requireValue(key, value);
      i += 1;
    } else if (key === "--evidence") {
      parsed.evidence = requireValue(key, value);
      i += 1;
    } else if (key === "--action") {
      parsed.action = requireValue(key, value);
      i += 1;
    } else if (key === "--next-check") {
      parsed.nextCheck = requireValue(key, value);
      i += 1;
    } else if (key === "--help" || key === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown option: ${key}`);
    }
  }

  return parsed;
}

function requireValue(key: string, value: string | undefined) {
  if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
  return value;
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
  --status VALUE     Candidate status. Default: watch
  --evidence VALUE   Evidence label. Default: report:quality
  --action VALUE     Action text. Default: 追加観察
  --next-check VALUE Next check text. Default: next weekly`);
}
