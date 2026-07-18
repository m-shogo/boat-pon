/**
 * 利益可能性を根底から確認する read-only 監査。
 *
 * DB/app_settings/production decision は変更しない。closing odds は診断専用で、
 * 実運用可能な T-5 odds として扱わない。
 */
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 30000;");

type Row = {
  race_id: string;
  race_date: string;
  combination: string;
  odds: number;
  winner: string;
  payout_yen: number;
};

type Metric = { n: number; hits: number; roi: number };

try {
  const rows = db.prepare(`
    WITH complete AS (
      SELECT race_id
      FROM historical_alternative_odds
      WHERE bet_type = 'exacta'
      GROUP BY race_id
      HAVING COUNT(*) = 30
    )
    SELECT h.race_id, h.race_date, h.combination, h.odds,
           p.combination AS winner, p.payout_yen
    FROM historical_alternative_odds h
    JOIN complete c ON c.race_id = h.race_id
    JOIN race_payouts p ON p.race_id = h.race_id
      AND p.bet_type = 'exacta' AND p.returned = 0
    WHERE h.bet_type = 'exacta'
    ORDER BY h.race_id, h.combination
  `).all() as Row[];

  const races = new Map<string, Row[]>();
  for (const row of rows) {
    const group = races.get(row.race_id);
    if (group) group.push(row);
    else races.set(row.race_id, [row]);
  }

  const years = [...new Set(rows.map((row) => row.race_date.slice(0, 4)))].sort();
  const trainYear = process.argv.includes("--train-year")
    ? process.argv[process.argv.indexOf("--train-year") + 1]
    : "2024";
  const forwardYear = process.argv.includes("--forward-year")
    ? process.argv[process.argv.indexOf("--forward-year") + 1]
    : "2025";
  const json = process.argv.includes("--json");

  const completeRaceCounts = Object.fromEntries(years.map((year) => [
    year,
    [...races.values()].filter((race) => race[0].race_date.startsWith(year)).length,
  ]));
  const programCounts = Object.fromEntries((db.prepare(`
    SELECT substr(date, 1, 4) AS year, COUNT(*) AS n
    FROM official_programs
    WHERE substr(date, 1, 4) IN (${years.map(() => "?").join(",")})
    GROUP BY substr(date, 1, 4)
  `).all(...years) as Array<{ year: string; n: number }>).map((row) => [row.year, row.n]));

  const combinations = [...new Set(rows.map((row) => row.combination))].sort();
  const byCombination = combinations.map((combination) => ({
    combination,
    train: fixedCombinationMetric(races, trainYear, combination),
    forward: fixedCombinationMetric(races, forwardYear, combination),
  }));
  const rankedByTrain = [...byCombination].sort((a, b) => b.train.roi - a.train.roi);
  const rankedByForward = [...byCombination].sort((a, b) => b.forward.roi - a.forward.roi);
  const bestTrain = rankedByTrain[0];
  const favorite = Object.fromEntries(years.map((year) => [year, favoriteMetric(races, year)]));
  const all30 = Object.fromEntries(years.map((year) => [year, allCombinationMetric(races, year)]));
  const trainForwardCorrelation = pearson(
    byCombination.map((row) => row.train.roi),
    byCombination.map((row) => row.forward.roi),
  );
  const forwardFavoriteRoi = favorite[forwardYear]?.roi ?? 0;

  const report = {
    generatedAt: new Date().toISOString(),
    verdict: bestTrain.forward.roi > 1 ? "EDGE_REQUIRES_FUTURE_CONFIRMATION" : "NO_VERIFIED_EDGE",
    safety: {
      readOnly: true,
      productionConnected: false,
      oddsTiming: "historical closing odds; unavailable as a T-5 execution signal",
      population: "historical_alternative_odds subset; not all official races",
    },
    split: { trainYear, forwardYear },
    coverage: Object.fromEntries(years.map((year) => [year, {
      exactaCompleteRaces: completeRaceCounts[year] ?? 0,
      officialPrograms: programCounts[year] ?? 0,
      coverageRate: (completeRaceCounts[year] ?? 0) / (programCounts[year] ?? 1),
    }])),
    diagnostics: {
      favorite,
      all30,
      breakEvenUpliftVsForwardFavorite: forwardFavoriteRoi > 0 ? (1 / forwardFavoriteRoi) - 1 : null,
      fixedCombinationTrainForwardCorrelation: trainForwardCorrelation,
      bestTrainCombination: bestTrain,
      bestForwardCombinationPostHocOnly: rankedByForward[0],
      topTrainCombinations: rankedByTrain.slice(0, 10),
    },
    conclusions: [
      "現行モデルと固定買い目のいずれにも、未使用期間で再現した利益優位性はない",
      "closing odds と選択的に収集したレースは、本番利益の証明には使えない",
      "BUY数を増やす変更は、優位性ではなく損失頻度を増やす",
      "次の投資対象は予測モデル調整ではなく、全レースT-5市場データと事前登録forward検証である",
    ],
  };

  if (json) console.log(JSON.stringify(report));
  else printReport(report);
} finally {
  db.close();
}

function fixedCombinationMetric(races: Map<string, Row[]>, year: string, combination: string): Metric {
  return selectionMetric(races, year, (race) => race.find((row) => row.combination === combination));
}

function favoriteMetric(races: Map<string, Row[]>, year: string): Metric {
  return selectionMetric(races, year, (race) => [...race].sort((a, b) => a.odds - b.odds || a.combination.localeCompare(b.combination))[0]);
}

function selectionMetric(races: Map<string, Row[]>, year: string, select: (race: Row[]) => Row | undefined): Metric {
  let n = 0;
  let hits = 0;
  let returned = 0;
  for (const race of races.values()) {
    if (!race[0].race_date.startsWith(year)) continue;
    const selected = select(race);
    if (!selected) continue;
    n += 1;
    if (selected.combination === selected.winner) {
      hits += 1;
      returned += selected.payout_yen;
    }
  }
  return { n, hits, roi: n === 0 ? 0 : returned / (n * 100) };
}

function allCombinationMetric(races: Map<string, Row[]>, year: string): Metric {
  const selected = [...races.values()].filter((race) => race[0].race_date.startsWith(year));
  const returned = selected.reduce((sum, race) => sum + race[0].payout_yen, 0);
  return { n: selected.length * 30, hits: selected.length, roi: selected.length === 0 ? 0 : returned / (selected.length * 3000) };
}

function pearson(xs: number[], ys: number[]) {
  if (xs.length !== ys.length || xs.length === 0) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const covariance = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0);
  const sx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0));
  const sy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return sx === 0 || sy === 0 ? null : covariance / (sx * sy);
}

function printReport(report: ReturnType<typeof reportShape>) {
  console.log("=== profit feasibility audit (read-only) ===");
  console.log(`verdict: ${report.verdict}`);
  console.log(`split: ${report.split.trainYear} -> ${report.split.forwardYear}`);
  for (const [year, coverage] of Object.entries(report.coverage)) {
    console.log(`${year} coverage: ${coverage.exactaCompleteRaces}/${coverage.officialPrograms} (${pct(coverage.coverageRate)})`);
  }
  for (const [year, metric] of Object.entries(report.diagnostics.favorite)) {
    console.log(`${year} closing favorite: n=${metric.n} hits=${metric.hits} ROI=${pct(metric.roi)}`);
  }
  const best = report.diagnostics.bestTrainCombination;
  console.log(`best fixed combo in train: ${best.combination} train=${pct(best.train.roi)} -> forward=${pct(best.forward.roi)}`);
  console.log(`fixed-combo ROI correlation: ${report.diagnostics.fixedCombinationTrainForwardCorrelation?.toFixed(3) ?? "n/a"}`);
  console.log(`break-even uplift needed vs forward favorite: ${pct(report.diagnostics.breakEvenUpliftVsForwardFavorite ?? 0)}`);
}

// Return typeだけを安定させるための非実行ヘルパー。
function reportShape() {
  return {} as {
    verdict: string;
    split: { trainYear: string; forwardYear: string };
    coverage: Record<string, { exactaCompleteRaces: number; officialPrograms: number; coverageRate: number }>;
    diagnostics: {
      favorite: Record<string, Metric>;
      fixedCombinationTrainForwardCorrelation: number | null;
      bestTrainCombination: { combination: string; train: Metric; forward: Metric };
      breakEvenUpliftVsForwardFavorite: number | null;
    };
  };
}

function pct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}
