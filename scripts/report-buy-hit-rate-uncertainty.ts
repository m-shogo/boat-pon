import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { wilson95 } from "../src/presentation/binomialWilsonInterval";
import { validateBuyLearningSummary, type BuyLearningSummary } from "../src/presentation/buyLearningSummary";

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.summary)) throw new Error("BUY learning summary is unavailable");

const summary = JSON.parse(await readFile(args.summary, "utf8")) as BuyLearningSummary;
const errors = validateBuyLearningSummary(summary);
if (errors.length) throw new Error(`BUY learning summary invalid: ${errors.join("; ")}`);

const report = summary.status === "AVAILABLE"
  ? {
      schemaVersion: "buy-hit-rate-uncertainty-public-v1" as const,
      generatedAt: new Date().toISOString(),
      status: "AVAILABLE" as const,
      performance: wilson95(summary.performance.hits ?? 0, summary.performance.settled ?? 0),
      recent: wilson95(summary.recent.hits ?? 0, summary.recent.settled ?? 0),
      note: "95% Wilson score intervals describe binomial hit-rate uncertainty only; they do not estimate payout ROI uncertainty.",
      productionChangeAllowed: false as const,
    }
  : {
      schemaVersion: "buy-hit-rate-uncertainty-public-v1" as const,
      generatedAt: new Date().toISOString(),
      status: "NOT_AVAILABLE" as const,
      performance: null,
      recent: null,
      note: "95% Wilson score intervals require settled BUY evidence.",
      productionChangeAllowed: false as const,
    };

const serialized = JSON.stringify(report);
for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "segmentKey", "/Users/", "/home/"]) {
  if (serialized.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`private BUY field reached hit-rate uncertainty report: ${forbidden}`);
}
await atomicWrite(args.output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  performance: report.performance,
  recent: report.recent,
  productionChangeAllowed: false,
}));

function parseArgs(argv: string[]) {
  const parsed = { summary: null as string | null, output: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--summary") { parsed.summary = safeJson(value); i += 1; }
    else if (key === "--output") { parsed.output = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!parsed.summary || !parsed.output) throw new Error("summary and output are required");
  return parsed as { summary: string; output: string };
}
function safeJson(value: string | undefined) {
  if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file");
  return value;
}
async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}
