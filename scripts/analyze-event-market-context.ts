/**
 * 保存済みレース前オッズHTMLの開催タイトルと暦を使い、注目イベントとexacta 1-4市場残差を調べる。
 * DB・ネットワークは読み取り専用。タイトル個別ランキングは作らず、事前定義カテゴリだけを集計する。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { load } from "cheerio";
import type { UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";
import { EVENT_CONTEXT_CATEGORIES, eventContextFlags } from "../src/domain/eventContext";

type Row = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  raw_json: string;
  overround: number;
  odds14: number;
  winner: string | null;
  payout_yen: number | null;
  wind_speed_mps: number | null;
  wind_dir: string | null;
};
type EvalRow = Row & { period: "discovery" | "forward"; title: string; flags: string[]; hit: boolean; implied: number };
type Metric = { n: number; hits: number; edgePp: number; roi: number; max2HitExclRoi: number };

const categories = EVENT_CONTEXT_CATEGORIES;

const db = new DatabaseSync(process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  const rows = db.prepare(`
    SELECT h.race_id, h.race_date AS date, h.venue, op.race_no, op.raw_json,
      SUM(1.0/h.odds) AS overround,
      MAX(CASE WHEN h.combination='1-4' THEN h.odds END) AS odds14,
      p.combination AS winner, p.payout_yen, w.wind_speed_mps, c.wind_dir
    FROM historical_alternative_odds h
    JOIN official_programs op ON op.race_id=h.race_id
    LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    LEFT JOIN race_weather w ON w.race_id=h.race_id
    LEFT JOIN race_conditions c ON c.race_id=h.race_id
    WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
      AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
    GROUP BY h.race_id HAVING COUNT(*)=30 AND odds14 IS NOT NULL
  `).all() as Row[];

  let titleAvailable = 0;
  const evaluations: EvalRow[] = rows.map(row => {
    const title = readEventTitle(row.race_id, row.date);
    if (title) titleAvailable += 1;
    const program = JSON.parse(row.raw_json) as UnconventionalProgram;
    const flags = eventContextFlags(title, row.date);
    if (row.wind_speed_mps != null && row.wind_speed_mps >= 2 && row.wind_speed_mps < 4 && row.wind_dir === "南西") flags.push("southwest");
    if (isTopRival(program, 4)) flags.push("top_rival_4");
    return { ...row, title, flags, period: row.date <= "2024-12-31" ? "discovery" : "forward", hit: row.winner === "1-4", implied: (1 / row.odds14) / row.overround };
  });

  const scopes = [
    { id: "all", label: "exacta 1-4全体", filter: (_row: EvalRow) => true },
    { id: "target", label: "風2〜3m・南西風・4号艇最強", filter: (row: EvalRow) => row.flags.includes("southwest") && row.flags.includes("top_rival_4") },
  ];
  const results = scopes.map(scope => ({
    id: scope.id,
    label: scope.label,
    base: byPeriod(evaluations.filter(scope.filter)),
    categories: categories.map(category => {
      const inside = evaluations.filter(row => scope.filter(row) && row.flags.includes(category.id));
      const outside = evaluations.filter(row => scope.filter(row) && !row.flags.includes(category.id));
      return { id: category.id, label: category.label, inside: byPeriod(inside), outside: byPeriod(outside) };
    }),
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    safety: { readOnly: true, preRaceSavedHtml: true, individualEventRanking: false, manipulationInference: false },
    coverage: { exactaRaces: evaluations.length, titleAvailable, titleCoverage: evaluations.length ? titleAvailable / evaluations.length : 0 },
    results,
    caveats: [
      "タイトル分類は保存済みkyotei24オッズHTMLの表示文字列を使う",
      "周年という語は競走場周年・BTS周年・企業周年を分離し、G1と一括しない",
      "暦カテゴリは結果を使わないが、祝日・帰省・売上を直接観測した変数ではない",
      "小標本カテゴリは効果なし・効果ありのどちらも断定しない",
    ],
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/event-market-context-screen.json", `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# イベント・開催文脈と市場残差screen", "",
    "> 保存済みレース前オッズHTMLの開催タイトルを事前定義カテゴリへ集約。個別開催や個人の疑惑ランキングは作らない。", "",
    `タイトルcoverage: ${titleAvailable}/${evaluations.length} (${pct(titleAvailable / evaluations.length)})`, "",
    ...results.flatMap(result => [
      `## ${result.label}`, "", `base: 2024 ${cell(result.base.discovery)} / 2025 ${cell(result.base.forward)}`, "",
      "| 文脈 | 2024 該当 n / edge / ROI / max2 | 2025 該当 n / edge / ROI / max2 | 条件外とのedge差 |", "|---|---:|---:|---:|",
      ...result.categories.map(row => `| ${row.label} | ${cell(row.inside.discovery)} | ${cell(row.inside.forward)} | ${deltaCell(row)} |`), "",
    ]),
    "## 読み方", "",
    "- イベントで人気・売上が変わる経路と、着順が変わる経路は別。ここでは正規化市場確率との差を見ているが売上は未観測。",
    "- 2024と2025で符号が揃い、十分なnがあり、条件外差と最大配当除外も残るものだけを次の仮説候補にする。",
    "- 最有力条件内は元々nが小さいため、イベント細分化は説明探索であり採用判断に使わない。",
  ];
  writeFileSync("reports/event-market-context-screen.md", `${lines.join("\n")}\n`);
  console.log(`event market context: exacta=${evaluations.length} titles=${titleAvailable}`);
} finally {
  db.close();
}

function readEventTitle(raceId: string, date: string) {
  const path = `data/raw/kyotei24/odds/${date}/${raceId}-odds3t.html`;
  if (!existsSync(path)) return "";
  const $ = load(readFileSync(path, "utf8"));
  return $(".rname a").first().text().replace(/\s+/g, " ").trim();
}
function isTopRival(program: UnconventionalProgram, course: number) {
  const own = program.boats.find(boat => boat.course === course)?.nationalWinRate;
  if (own == null) return false;
  return program.boats.filter(boat => boat.course !== 1 && boat.course !== course).every(boat => own >= (boat.nationalWinRate ?? Number.POSITIVE_INFINITY));
}
function byPeriod(rows: EvalRow[]) { return { discovery: metric(rows.filter(row => row.period === "discovery")), forward: metric(rows.filter(row => row.period === "forward")) }; }
function metric(rows: EvalRow[]): Metric {
  const payouts = rows.filter(row => row.hit).map(row => row.payout_yen ?? 0).sort((a, b) => b - a);
  const total = payouts.reduce((sum, payout) => sum + payout, 0);
  const expected = rows.reduce((sum, row) => sum + row.implied, 0);
  return { n: rows.length, hits: payouts.length, edgePp: rows.length ? (payouts.length - expected) / rows.length * 100 : 0, roi: rows.length ? total / (rows.length * 100) : 0, max2HitExclRoi: rows.length > 2 ? (total - (payouts[0] ?? 0) - (payouts[1] ?? 0)) / ((rows.length - 2) * 100) : 0 };
}
function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function cell(value: Metric) { return `${value.n} / ${value.edgePp >= 0 ? "+" : ""}${value.edgePp.toFixed(2)}pt / ${pct(value.roi)} / ${pct(value.max2HitExclRoi)}`; }
function deltaCell(row: { inside: ReturnType<typeof byPeriod>; outside: ReturnType<typeof byPeriod> }) {
  const value = (period: "discovery" | "forward", label: string) => {
    if (!row.inside[period].n || !row.outside[period].n) return `${label} n/a`;
    const delta = row.inside[period].edgePp - row.outside[period].edgePp;
    return `${label} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pt`;
  };
  return `${value("discovery", "2024")} / ${value("forward", "2025")}`;
}
