import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const commands = [
  ["tsx", "scripts/search-roi-patterns.ts"],
  ["tsx", "scripts/analyze-roi-hypothesis-sets.ts"],
] as const;

for (const command of commands) {
  console.log(`[run-roi-search-suite] ${command.join(" ")}`);
  execFileSync(command[0], command.slice(1), { stdio: "inherit" });
}

const files = [
  "reports/roi-pattern-search.json",
  "reports/roi-hypothesis-sets.json",
] as const;

const lines: string[] = [];
lines.push("# ROI Search Suite Summary");
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");

for (const file of files) {
  lines.push(`## ${file}`);
  lines.push("");
  if (!existsSync(file)) {
    lines.push("missing");
    lines.push("");
    continue;
  }
  const json = JSON.parse(readFileSync(file, "utf8")) as any;
  if (json.baseline) {
    lines.push(`- baseline n: ${json.baseline.n}`);
    lines.push(`- baseline ROI: ${pct(json.baseline.roi)}`);
    lines.push(`- baseline ROI ex max hit: ${pct(json.baseline.roiExMaxHit)}`);
  }
  if (json.counts) {
    lines.push(`- total: ${json.counts.total ?? json.counts.totalEvaluations ?? ""}`);
    lines.push(`- S: ${json.counts.s ?? json.counts.sCount ?? 0}`);
    lines.push(`- A: ${json.counts.a ?? json.counts.aCount ?? 0}`);
  }
  const ranking = json.rankings?.stability ?? json.results ?? [];
  lines.push("");
  lines.push("| rule | remainN | remainROI | improvement | validation | test | warnings |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const item of ranking.slice(0, 12)) {
    const name = item.name ?? item.label ?? "unknown";
    const remaining = item.remaining ?? {};
    const split = item.split ?? {};
    lines.push(`| ${md(name)} | ${remaining.n ?? ""} | ${pct(remaining.roi)} | ${pct(item.improvement)} | ${pct(item.validationRoi ?? split.validation?.roi)} | ${pct(item.testRoi ?? split.test?.roi)} | ${md((item.warnings ?? []).join(", ") || "-")} |`);
  }
  lines.push("");
}

writeFileSync("reports/roi-search-suite-summary.md", `${lines.join("\n")}\n`);
console.log("[run-roi-search-suite] wrote reports/roi-search-suite-summary.md");

function pct(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${(value * 100).toFixed(2)}%`;
}

function md(value: string) {
  return value.replaceAll("|", "\\|");
}
