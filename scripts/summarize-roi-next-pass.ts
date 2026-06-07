import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "reports/roi-next-pass.md";
const searchPath = "reports/roi-pattern-search.json";
const hypothesisPath = "reports/roi-hypothesis-sets.json";

type Candidate = {
  source: string;
  name: string;
  judgement: string;
  remainN: number;
  remainRoi: number;
  improvement: number;
  validationRoi: number | null;
  testRoi: number | null;
  warnings: string[];
};

const candidates: Candidate[] = [];

readSearchReport();
readHypothesisReport();

const stable = candidates
  .filter((x) => ["S", "A", "scenario"].includes(x.judgement))
  .filter((x) => x.remainN >= 100)
  .sort((a, b) => score(b) - score(a));

const risky = candidates
  .filter((x) => x.warnings.length > 0 || x.remainN < 300)
  .sort((a, b) => b.improvement - a.improvement);

const lines: string[] = [];
lines.push("# ROI Next Pass");
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");
lines.push("## Stable candidates to inspect first");
lines.push("");
lines.push(table(stable.slice(0, 30)));
lines.push("");
lines.push("## Risky candidates to avoid overfitting");
lines.push("");
lines.push(table(risky.slice(0, 30)));
lines.push("");
lines.push("## Suggested second-pass focus");
lines.push("");
lines.push("1. Keep only candidates where validation/test do not collapse.");
lines.push("2. Prefer remainN >= 1000 for setting proposals, remainN >= 300 for paper-only checks.");
lines.push("3. Re-test low boat, high motor trap, raceNo, venue, and odds interactions separately.");
lines.push("4. Do not use a condition if its ROI improvement disappears after warnings are considered.");
lines.push("");

writeFileSync(OUT, `${lines.join("\n")}\n`);
console.log(`[summarize-roi-next-pass] wrote ${OUT}`);

function readSearchReport() {
  if (!existsSync(searchPath)) return;
  const json = JSON.parse(readFileSync(searchPath, "utf8")) as any;
  for (const groupName of ["stability", "improvement", "noBuyEffect"]) {
    for (const item of json.rankings?.[groupName] ?? []) {
      candidates.push({
        source: `pattern:${groupName}`,
        name: item.label ?? "unknown",
        judgement: item.judgement ?? "",
        remainN: item.remaining?.n ?? 0,
        remainRoi: item.remaining?.roi ?? 0,
        improvement: item.improvement ?? 0,
        validationRoi: item.validationRoi ?? null,
        testRoi: item.testRoi ?? null,
        warnings: item.warnings ?? [],
      });
    }
  }
}

function readHypothesisReport() {
  if (!existsSync(hypothesisPath)) return;
  const json = JSON.parse(readFileSync(hypothesisPath, "utf8")) as any;
  for (const item of json.results ?? []) {
    candidates.push({
      source: "hypothesis",
      name: item.name ?? "unknown",
      judgement: "scenario",
      remainN: item.remaining?.n ?? 0,
      remainRoi: item.remaining?.roi ?? 0,
      improvement: item.improvement ?? 0,
      validationRoi: item.split?.validation?.roi ?? null,
      testRoi: item.split?.test?.roi ?? null,
      warnings: item.warnings ?? [],
    });
  }
}

function score(item: Candidate) {
  let value = 0;
  value += item.improvement * 100;
  value += Math.min(20, item.remainN / 100);
  value += (item.validationRoi ?? 0) * 10;
  value += (item.testRoi ?? 0) * 10;
  value -= item.warnings.length * 5;
  if (item.remainN < 300) value -= 15;
  return value;
}

function table(items: Candidate[]) {
  if (!items.length) return "None\n";
  return `| source | judgement | name | remainN | remainROI | improvement | validation | test | warnings |\n|---|---|---|---:|---:|---:|---:|---:|---|\n${items.map((x) => `| ${md(x.source)} | ${md(x.judgement)} | ${md(x.name)} | ${x.remainN} | ${pct(x.remainRoi)} | ${pct(x.improvement)} | ${pct(x.validationRoi)} | ${pct(x.testRoi)} | ${md(x.warnings.join(", ") || "-")} |`).join("\n")}\n`;
}

function pct(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${(value * 100).toFixed(2)}%`;
}

function md(value: string) {
  return value.replaceAll("|", "\\|");
}
