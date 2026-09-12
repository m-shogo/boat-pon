/** exacta 1-Xの2着艇をレース前情報で動的に1艇選ぶread-only比較。 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { selectDynamicSecond, type RivalContext, type RivalStrategy } from "../src/domain/dynamicSecondSelector";
import type { UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";
import {
  historicalExactaCanonicalSourcePredicate,
  historicalExactaCompleteMarketPredicate,
} from "../src/research-replay/historicalExactaMarketAuthority";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

type RaceRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  raw_json: string;
  winner: string;
  payout_yen: number;
};
type OddsRow = { race_id: string; combination: string; odds: number };
type ExhRow = { race_id: string; course: number; exhibition_time: number };
type Outcome = {
  period: "discovery" | "forward";
  strategy: string;
  selection: string;
  implied: number;
  hit: boolean;
  payout: number;
  venue: string;
};
type Metric = { n: number; hits: number; edgePp: number; roi: number; max2HitExclRoi: number };
type CoverageRow = { period: string; total: number; settled: number; ambiguous: number };

const strategyDefs: Array<{ id: string; label: string; strategy?: RivalStrategy; fixed?: number }> = [
  { id: "fixed_4", label: "固定4号艇", fixed: 4 },
  { id: "national_best", label: "全国勝率最上位", strategy: "national_best" },
  { id: "local_best", label: "当地勝率最上位", strategy: "local_best" },
  { id: "motor_best", label: "モーター2連率最上位", strategy: "motor_best" },
  { id: "exhibition_best", label: "展示最速", strategy: "exhibition_best" },
  { id: "consensus", label: "全国・当地・モーター・展示の合議", strategy: "consensus" },
  { id: "ability_underbought", label: "能力順位より市場人気が低い艇", strategy: "ability_underbought" },
  { id: "market_favorite", label: "1-Xで市場最人気", strategy: "market_favorite" },
  { id: "national_worst_placebo", label: "全国勝率最低_placebo", strategy: "national_worst_placebo" },
];

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const JSON_REPORT_PATH = "reports/dynamic-second-selector.json";
const MARKDOWN_REPORT_PATH = "reports/dynamic-second-selector.md";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "DYNAMIC_SECOND_PRIMARY_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

function atomicPublish(path: string, contents: string, errorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, errorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

try {
  assertSettlementCompleteness();

  const races = db.prepare(`
    WITH market_races AS (
      SELECT h.race_id, h.race_date AS date, h.venue, h.race_no
      FROM historical_alternative_odds h
      WHERE h.bet_type='exacta'
        AND ${historicalExactaCanonicalSourcePredicate("h")}
        AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
        AND NOT EXISTS (
          SELECT 1 FROM race_entries re
          WHERE re.race_id=h.race_id AND re.status_code='F'
        )
        AND ${historicalExactaCompleteMarketPredicate("h.race_id")}
      GROUP BY h.race_id, h.race_date, h.venue, h.race_no
    )
    SELECT m.race_id, m.date, m.venue, m.race_no, op.raw_json,
      p.combination AS winner, p.payout_yen
    FROM market_races m
    JOIN official_programs op ON op.race_id=m.race_id
    JOIN race_payouts p ON p.race_id=m.race_id
      AND p.bet_type='exacta'
      AND p.returned=0
      AND p.combination IS NOT NULL AND trim(p.combination)!=''
      AND p.payout_yen IS NOT NULL AND p.payout_yen>0
    ORDER BY m.date, m.race_id
  `).all() as RaceRow[];

  const oddsRows = db.prepare(`
    SELECT h.race_id, h.combination, h.odds
    FROM historical_alternative_odds h
    WHERE h.bet_type='exacta'
      AND ${historicalExactaCanonicalSourcePredicate("h")}
      AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
      AND ${historicalExactaCompleteMarketPredicate("h.race_id")}
  `).all() as OddsRow[];
  const exhRows = db.prepare(
    "SELECT race_id,course,exhibition_time FROM exhibition_data WHERE exhibition_time IS NOT NULL",
  ).all() as ExhRow[];

  const odds = new Map<string, Map<string, number>>();
  for (const row of oddsRows) {
    const market = odds.get(row.race_id) ?? new Map<string, number>();
    market.set(row.combination, row.odds);
    odds.set(row.race_id, market);
  }
  const exhibition = new Map<string, Map<number, number>>();
  for (const row of exhRows) {
    const race = exhibition.get(row.race_id) ?? new Map<number, number>();
    race.set(row.course, row.exhibition_time);
    exhibition.set(row.race_id, race);
  }

  const outcomes: Outcome[] = [];
  for (const race of races) {
    const market = odds.get(race.race_id);
    if (!market || market.size !== 30) continue;
    const overround = [...market.values()].reduce((sum, value) => sum + 1 / value, 0);
    const program = JSON.parse(race.raw_json) as UnconventionalProgram;
    if (program.boats.length !== 6) continue;
    const probabilities = new Map<number, number>();
    for (let course = 2; course <= 6; course += 1) {
      const price = market.get(`1-${course}`);
      if (price) probabilities.set(course, (1 / price) / overround);
    }
    const context: RivalContext = {
      boats: program.boats,
      marketProbability: probabilities,
      exhibitionTime: exhibition.get(race.race_id) ?? new Map(),
    };
    for (const definition of strategyDefs) {
      const second = definition.fixed ?? selectDynamicSecond(context, definition.strategy!);
      if (second == null) continue;
      const selection = `1-${second}`;
      const price = market.get(selection);
      if (!price) continue;
      const hit = race.winner === selection;
      outcomes.push({
        period: race.date <= "2024-12-31" ? "discovery" : "forward",
        strategy: definition.id,
        selection,
        implied: (1 / price) / overround,
        hit,
        payout: hit ? race.payout_yen : 0,
        venue: race.venue,
      });
    }
  }

  const results = strategyDefs.map((definition) => {
    const rows = outcomes.filter((row) => row.strategy === definition.id);
    const discovery = metric(rows.filter((row) => row.period === "discovery"));
    const forward = metric(rows.filter((row) => row.period === "forward"));
    return {
      id: definition.id,
      label: definition.label,
      discovery,
      forward,
      selectionDistribution: distribution(rows),
      leaveOneVenue: {
        discovery: leaveOne(rows.filter((row) => row.period === "discovery")),
        forward: leaveOne(rows.filter((row) => row.period === "forward")),
      },
    };
  });
  const robust = results.filter((row) =>
    row.discovery.roi >= 1
    && row.forward.roi >= 1
    && row.discovery.max2HitExclRoi >= 1
    && row.forward.max2HitExclRoi >= 1
    && row.leaveOneVenue.discovery >= 1
    && row.leaveOneVenue.forward >= 1
  );
  const fixed = results.find((row) => row.id === "fixed_4");
  if (!fixed) throw new Error("DYNAMIC_SECOND_FIXED_BASELINE_MISSING");
  const evaluatedRaces = fixed.discovery.n + fixed.forward.n;
  const report = {
    generatedAt: new Date().toISOString(),
    safety: { readOnly: true, oneTicketPerRace: true, preRaceFeatures: true, productionConnected: false },
    coverage: {
      candidateRaces: races.length,
      evaluatedCompleteMarkets: evaluatedRaces,
      rejectedMarkets: races.length - evaluatedRaces,
      outcomes: outcomes.length,
    },
    results,
    robust,
    caveats: [
      "全戦略1レース1点100円",
      "official_programs当時値と展示を使用",
      "30行でも組番重複・欠損のmarketは除外",
      "ability_underboughtは順位差でオッズ倍率を直接最適化しない",
      "closing oddsでT-5ではない",
      "最低全国勝率は偽陽性対照",
    ],
  };
  mkdirSync("reports", { recursive: true });
  const lines = [
    "# exacta 1-X 動的2着艇セレクター",
    "",
    "> 1着1号艇を固定し、2着をレース前情報で1艇だけ選ぶ。全戦略1点100円。",
    "",
    `coverage: 候補${races.length} / 完全市場評価${evaluatedRaces} / 除外${races.length - evaluatedRaces}レース / closing odds（T-5ではない）`,
    "",
    "| 戦略 | 2024 n / edge / ROI / max2 / LOO最小 | 2025 n / edge / ROI / max2 / LOO最小 | 選択分布 |",
    "|---|---:|---:|---|",
    ...results.map((row) => `| ${row.label} | ${cell(row.discovery)} / ${pct(row.leaveOneVenue.discovery)} | ${cell(row.forward)} / ${pct(row.leaveOneVenue.forward)} | ${dist(row.selectionDistribution)} |`),
    "",
    `全利益gate通過: ${robust.length}戦略。`,
    "",
    "## 判定",
    "",
    "- 的中率が上がっても、正規化市場確率を超えず控除後ROIが100%未満なら改善ではない。",
    "- 動的選択が固定1-4とplaceboを両年・外れ値除外・会場除外で上回る場合だけ次段階へ進める。",
  ];
  atomicPublish(
    JSON_REPORT_PATH,
    `${JSON.stringify(report, null, 2)}\n`,
    "DYNAMIC_SECOND_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  );
  atomicPublish(
    MARKDOWN_REPORT_PATH,
    `${lines.join("\n")}\n`,
    "DYNAMIC_SECOND_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID",
  );
  console.log(`dynamic second: candidates=${races.length} evaluated=${evaluatedRaces} strategies=${results.length} robust=${robust.length}`);
} finally {
  db.close();
}

function assertSettlementCompleteness(): void {
  const rows = db.prepare(`
    WITH population AS (
      SELECT h.race_id, h.race_date AS date
      FROM historical_alternative_odds h
      WHERE h.bet_type='exacta'
        AND ${historicalExactaCanonicalSourcePredicate("h")}
        AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
        AND NOT EXISTS (
          SELECT 1 FROM race_entries re
          WHERE re.race_id=h.race_id AND re.status_code='F'
        )
        AND ${historicalExactaCompleteMarketPredicate("h.race_id")}
      GROUP BY h.race_id, h.race_date
    ), settlement AS (
      SELECT rp.race_id,
        COUNT(*) AS payout_rows,
        SUM(CASE WHEN rp.returned=0
          AND rp.combination IS NOT NULL AND trim(rp.combination)!=''
          AND rp.payout_yen IS NOT NULL AND rp.payout_yen>0
          THEN 1 ELSE 0 END) AS valid_rows
      FROM race_payouts rp
      WHERE rp.bet_type='exacta'
      GROUP BY rp.race_id
    )
    SELECT CASE WHEN p.date<='2024-12-31' THEN 'discovery' ELSE 'forward' END AS period,
      COUNT(*) AS total,
      SUM(CASE WHEN s.payout_rows=1 AND s.valid_rows=1 THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN COALESCE(s.payout_rows,0)>1 THEN 1 ELSE 0 END) AS ambiguous
    FROM population p
    LEFT JOIN settlement s ON s.race_id=p.race_id
    GROUP BY period
    ORDER BY period
  `).all() as CoverageRow[];

  const byPeriod = Object.fromEntries(["discovery", "forward"].map((period) => {
    const row = rows.find((candidate) => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    const ambiguous = Number(row?.ambiguous ?? 0);
    return [period, { total, settled, missing: total - settled, ambiguous }];
  }));
  const invalid = ["discovery", "forward"].some((period) => {
    const { total, settled, missing, ambiguous } = byPeriod[period];
    return !Number.isInteger(total)
      || !Number.isInteger(settled)
      || !Number.isInteger(ambiguous)
      || total <= 0
      || settled !== total
      || missing !== 0
      || ambiguous !== 0;
  });
  if (invalid) {
    throw new Error(`DYNAMIC_SECOND_EXACTA_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
  }
}

function metric(rows: Outcome[]): Metric {
  const payouts = rows.filter((row) => row.hit).map((row) => row.payout).sort((a, b) => b - a);
  const total = payouts.reduce((sum, payout) => sum + payout, 0);
  const expected = rows.reduce((sum, row) => sum + row.implied, 0);
  return {
    n: rows.length,
    hits: payouts.length,
    edgePp: rows.length ? (payouts.length - expected) / rows.length * 100 : 0,
    roi: rows.length ? total / (rows.length * 100) : 0,
    max2HitExclRoi: rows.length > 2
      ? (total - (payouts[0] ?? 0) - (payouts[1] ?? 0)) / ((rows.length - 2) * 100)
      : 0,
  };
}
function leaveOne(rows: Outcome[]): number {
  const values = [...new Set(rows.map((row) => row.venue))]
    .map((venue) => metric(rows.filter((row) => row.venue !== venue)).max2HitExclRoi);
  return values.length ? Math.min(...values) : 0;
}
function distribution(rows: Outcome[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const row of rows) values[row.selection] = (values[row.selection] ?? 0) + 1;
  return values;
}
function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }
function cell(value: Metric): string {
  return `${value.n} / ${signed(value.edgePp)}pt / ${pct(value.roi)} / ${pct(value.max2HitExclRoi)}`;
}
function dist(values: Record<string, number>): string {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (!total) return "";
  return Object.entries(values).sort().map(([key, value]) => `${key}:${(value / total * 100).toFixed(0)}%`).join(" ");
}
