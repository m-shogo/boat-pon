import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { load } from "js-yaml";
import { todayJst } from "./date.js";
import type { BuffettQualitySnapshot } from "./pro-types.js";

type Company = {
  code: string;
  name: string;
  role?: string;
  evidenceToCheck?: string[];
  upsideHypothesis?: string;
  noMoveHypothesis?: string;
  downsideHypothesis?: string;
};
type Hypotheses = { categories?: Record<string, { companies?: Company[] }> };

type LatestScore = {
  code: string;
  name: string;
  reasons?: string[];
  negativeReasons?: string[];
  warnings?: string[];
  dataQuality?: string;
};

function readYaml<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return load(readFileSync(path, "utf-8")) as T;
}

function readLatestScores(): LatestScore[] {
  if (!existsSync("reports")) return [];
  try {
    const files = readdirSync("reports").filter(file => /^scores_\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort();
    const latest = files.at(-1);
    if (!latest) return [];
    const parsed = JSON.parse(readFileSync(join("reports", latest), "utf-8"));
    return Array.isArray(parsed) ? parsed as LatestScore[] : [];
  } catch {
    return [];
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function classifyQuality(company: Company, score?: LatestScore): BuffettQualitySnapshot {
  const text = [
    company.role,
    company.upsideHypothesis,
    company.noMoveHypothesis,
    company.downsideHypothesis,
    ...(company.evidenceToCheck ?? []),
    ...(score?.reasons ?? []),
    ...(score?.negativeReasons ?? []),
    ...(score?.warnings ?? []),
  ].filter(Boolean).join(" ");

  const missingData = ["ROIC 5年平均", "ROE 5年平均", "FCF 5年推移", "営業利益率 5年推移", "自己資本比率", "希薄化/増資履歴"];
  const moatEvidence: string[] = [];
  const pricingPowerEvidence: string[] = [];

  if (/ブランド|IP|ライセンス|キャラクター|任天堂|サンリオ/.test(text)) {
    moatEvidence.push("ブランド/IPによる競争優位の可能性");
    pricingPowerEvidence.push("ライセンス/ブランド価値による価格決定力を要確認");
  }
  if (/ネットワーク|プラットフォーム|データセンター|インフラ/.test(text)) moatEvidence.push("ネットワーク/インフラ型の参入障壁候補");
  if (/景気敏感|市況|素材|メモリ|半導体|防衛|重工/.test(text)) moatEvidence.push("景気循環・政策需要の影響が大きく、品質判定は保留");

  const qualityLabel: BuffettQualitySnapshot["qualityLabel"] = moatEvidence.some(v => /ブランド|IP/.test(v))
    ? "good_business"
    : /景気敏感|市況|メモリ|半導体|重工/.test(text)
      ? "cyclical_quality"
      : "unknown";

  return {
    code: company.code,
    name: company.name,
    asOf: todayJst(),
    roe5yAvg: null,
    roic5yAvg: null,
    operatingMargin5yAvg: null,
    operatingMarginStability: "unknown",
    fcfPositiveYears5y: null,
    fcfMargin5yAvg: null,
    equityRatio: null,
    netDebtToEbitda: null,
    dilutionRisk: "unknown",
    pricingPowerEvidence: unique(pricingPowerEvidence),
    moatEvidence: unique(moatEvidence),
    qualityLabel,
    missingData,
  };
}

function main() {
  const hypotheses = readYaml<Hypotheses>("config/company-hypotheses.yml", {});
  const scores = new Map(readLatestScores().map(score => [score.code, score]));
  const companies = Object.values(hypotheses.categories ?? {}).flatMap(category => category.companies ?? []);
  const snapshots = companies.map(company => classifyQuality(company, scores.get(company.code)));
  mkdirSync("data", { recursive: true });
  writeFileSync("data/buffett_quality_latest.json", JSON.stringify({ generatedAt: todayJst(), snapshots }, null, 2), "utf-8");
  console.log(`buffett quality snapshots generated: ${snapshots.length}`);
}

main();
