/**
 * analyze-promising-bet-type-strategies.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: screening で相対的に良かった券種を複数戦略で深掘りし、
 *       point数・ROI・ExMaxHit を比較する。
 *
 * 対象: exacta / quinella / trio / trifecta (wide は ROI が大幅低下のため参考のみ)
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/promising-bet-type-strategies.md";
const OUT_JSON = "reports/promising-bet-type-strategies.json";
const STAKE = 100;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── データ取得 ──────────────────────────────────────────────────────────────

type RawRow = { race_id: string; date: string; selection: string };

const rows = db.prepare(`
  SELECT race_id, date, selection FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
  ORDER BY date
`).all() as RawRow[];

type PayoutRow = { race_id: string; bet_type: string; combination: string; payout_yen: number | null; returned: number };

const payoutIndex = new Map<string, number>();
const returnedSet = new Set<string>();

for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts WHERE bet_type IN ('exacta','quinella','wide','trifecta','trio')
`).all() as PayoutRow[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  payoutIndex.set(key, p.payout_yen ?? 0);
  if (p.returned) returnedSet.add(key);
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function sel(s: string): [number, number, number] {
  const p = s.split("-").map(Number); return [p[0], p[1], p[2]] as [number, number, number];
}
function sp(a: number, b: number) { return a < b ? `${a}-${b}` : `${b}-${a}`; }
function st(a: number, b: number, c: number) { return [a,b,c].sort((x,y)=>x-y).join("-"); }
function getPayout(raceId: string, bt: string, comb: string): number | null {
  const key = `${raceId}|${bt}|${comb}`;
  if (returnedSet.has(key)) return null;
  return payoutIndex.get(key) ?? 0;
}
function median(arr: number[]) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}

// ─── 戦略定義 ────────────────────────────────────────────────────────────────

type Ticket = { dbBetType: string; combination: string };
type StrategyDef = {
  name: string;
  betType: string;
  getTickets: (s: [number, number, number]) => Ticket[];
};

const STRATEGIES: StrategyDef[] = [
  // ── 3連単 ──
  { name: "3連単: S1-S2-S3 (現行)", betType: "3連単", getTickets: ([s1,s2,s3]) => [{ dbBetType:"trifecta", combination:`${s1}-${s2}-${s3}` }] },
  { name: "3連単: S1-S3-S2 (2/3逆)", betType: "3連単", getTickets: ([s1,s2,s3]) => [{ dbBetType:"trifecta", combination:`${s1}-${s3}-${s2}` }] },
  { name: "3連単: S1-S2-S3 + S1-S3-S2 (1着固定2点)", betType: "3連単",
    getTickets: ([s1,s2,s3]) => [
      { dbBetType:"trifecta", combination:`${s1}-${s2}-${s3}` },
      { dbBetType:"trifecta", combination:`${s1}-${s3}-${s2}` },
    ]
  },
  { name: "3連単: 3艇ボックス(6点)", betType: "3連単",
    getTickets: ([s1,s2,s3]) => {
      const perms = [[s1,s2,s3],[s1,s3,s2],[s2,s1,s3],[s2,s3,s1],[s3,s1,s2],[s3,s2,s1]];
      return perms.map(([a,b,c]) => ({ dbBetType:"trifecta", combination:`${a}-${b}-${c}` }));
    }
  },

  // ── 3連複 ──
  { name: "3連複: sorted(S1,S2,S3)", betType: "3連複", getTickets: ([s1,s2,s3]) => [{ dbBetType:"trio", combination:st(s1,s2,s3) }] },

  // ── 2連単 ──
  { name: "2連単: S1-S2", betType: "2連単", getTickets: ([s1,s2]) => [{ dbBetType:"exacta", combination:`${s1}-${s2}` }] },
  { name: "2連単: S1-S3", betType: "2連単", getTickets: ([s1,,s3]) => [{ dbBetType:"exacta", combination:`${s1}-${s3}` }] },
  { name: "2連単: S1-S2 + S1-S3 (1着固定2点)", betType: "2連単",
    getTickets: ([s1,s2,s3]) => [
      { dbBetType:"exacta", combination:`${s1}-${s2}` },
      { dbBetType:"exacta", combination:`${s1}-${s3}` },
    ]
  },
  { name: "2連単: S1-S2 + S2-S1 (折り返し2点)", betType: "2連単",
    getTickets: ([s1,s2]) => [
      { dbBetType:"exacta", combination:`${s1}-${s2}` },
      { dbBetType:"exacta", combination:`${s2}-${s1}` },
    ]
  },
  { name: "2連単: 3艇ボックス(6点)", betType: "2連単",
    getTickets: ([s1,s2,s3]) => {
      const perms = [[s1,s2],[s1,s3],[s2,s1],[s2,s3],[s3,s1],[s3,s2]];
      return perms.map(([a,b]) => ({ dbBetType:"exacta", combination:`${a}-${b}` }));
    }
  },

  // ── 2連複 ──
  { name: "2連複: S1=S2", betType: "2連複", getTickets: ([s1,s2]) => [{ dbBetType:"quinella", combination:sp(s1,s2) }] },
  { name: "2連複: S1=S3", betType: "2連複", getTickets: ([s1,,s3]) => [{ dbBetType:"quinella", combination:sp(s1,s3) }] },
  { name: "2連複: S2=S3", betType: "2連複", getTickets: ([,s2,s3]) => [{ dbBetType:"quinella", combination:sp(s2,s3) }] },
  { name: "2連複: S1軸 S1=S2 + S1=S3 (2点)", betType: "2連複",
    getTickets: ([s1,s2,s3]) => [
      { dbBetType:"quinella", combination:sp(s1,s2) },
      { dbBetType:"quinella", combination:sp(s1,s3) },
    ]
  },
  { name: "2連複: 3艇ボックス(3点)", betType: "2連複",
    getTickets: ([s1,s2,s3]) => [
      { dbBetType:"quinella", combination:sp(s1,s2) },
      { dbBetType:"quinella", combination:sp(s1,s3) },
      { dbBetType:"quinella", combination:sp(s2,s3) },
    ]
  },

  // ── 拡連複 (参考) ──
  { name: "拡連複: S1=S2 (参考)", betType: "拡連複", getTickets: ([s1,s2]) => [{ dbBetType:"wide", combination:sp(s1,s2) }] },
  { name: "拡連複: 3艇ボックス 3点 (参考)", betType: "拡連複",
    getTickets: ([s1,s2,s3]) => [
      { dbBetType:"wide", combination:sp(s1,s2) },
      { dbBetType:"wide", combination:sp(s1,s3) },
      { dbBetType:"wide", combination:sp(s2,s3) },
    ]
  },
];

// ─── 評価関数 ────────────────────────────────────────────────────────────────

type StrategyResult = {
  name: string;
  betType: string;
  nRaces: number;
  totalTickets: number;
  avgTicketsPerRace: number;
  totalStake: number;
  hitTickets: number;      // 的中チケット数（複数点戦略で1レース複数になりうる）
  hitRaces: number;        // 的中レース数（1レースで複数的中でも1カウント）
  ticketHitRate: number;   // hitTickets / totalTickets
  raceHitRate: number;     // hitRaces / nRaces
  avgOdds: number;
  medianOdds: number;
  maxOdds: number;
  totalReturn: number;
  ROI: number;
  roiExMaxHit: number;
  roiExMax3Hits: number;
  year2024ROI: number;
  year2025ROI: number;
  verdict: "有望" | "参考" | "非効率" | "要確認";
};

function evaluate(strat: StrategyDef): StrategyResult {
  let totalTickets = 0;
  let totalReturn = 0;
  let validRaces = 0;
  let hitRaces = 0;         // 1つ以上的中したレース数
  const hitPayouts: number[] = []; // 的中チケットの払戻（複数点戦略で1レース複数あり）
  const hitOdds: number[] = [];

  const ymStake = new Map<string, number>();
  const ymReturn = new Map<string, number>();

  for (const row of rows) {
    const s = sel(row.selection);
    const tickets = strat.getTickets(s);
    const ym = row.date.slice(0, 7);

    // returned チェック（全チケット返還の場合はスキップ）
    const allReturned = tickets.every(t => returnedSet.has(`${row.race_id}|${t.dbBetType}|${t.combination}`));
    if (allReturned) continue;

    validRaces++;
    const stake = tickets.length * STAKE;
    totalTickets += tickets.length;
    ymStake.set(ym, (ymStake.get(ym) ?? 0) + stake);

    let raceReturn = 0;
    let raceHit = false;
    for (const t of tickets) {
      const p = getPayout(row.race_id, t.dbBetType, t.combination);
      if (p !== null && p > 0) {
        raceReturn += p;
        hitPayouts.push(p);
        hitOdds.push(p / 100);
        raceHit = true;
      }
    }
    if (raceHit) hitRaces++;
    totalReturn += raceReturn;
    ymReturn.set(ym, (ymReturn.get(ym) ?? 0) + raceReturn);
  }

  const totalStake = totalTickets * STAKE;
  const hitTickets = hitPayouts.length;
  const ROI = totalStake > 0 ? Math.round(totalReturn / totalStake * 10000) / 100 : 0;

  const sortedH = [...hitPayouts].sort((a,b) => b-a);
  const roi1 = totalStake > STAKE ? Math.round((totalReturn - sortedH[0]) / (totalStake - STAKE) * 10000) / 100 : 0;
  const roi3 = totalStake > 3*STAKE ? Math.round((totalReturn - sortedH.slice(0,3).reduce((s,v)=>s+v,0)) / (totalStake - 3*STAKE) * 10000) / 100 : 0;

  function ymROI(filter: (ym: string) => boolean) {
    let s = 0, r = 0;
    for (const [ym, st] of ymStake) { if (filter(ym)) { s += st; r += ymReturn.get(ym) ?? 0; } }
    return s > 0 ? Math.round(r / s * 10000) / 100 : 0;
  }

  const avgOdds = hitTickets > 0 ? hitOdds.reduce((s,o)=>s+o,0)/hitTickets : 0;
  const ticketHitRate = totalTickets > 0 ? Math.round(hitTickets/totalTickets*10000)/100 : 0;
  const raceHitRate = validRaces > 0 ? Math.round(hitRaces/validRaces*10000)/100 : 0;

  let verdict: StrategyResult["verdict"] = "非効率";
  if (ROI >= 95 && roi1 >= 85) verdict = "有望";
  else if (ROI >= 85) verdict = "参考";
  else if (hitTickets < 5) verdict = "要確認";

  return {
    name: strat.name, betType: strat.betType,
    nRaces: validRaces, totalTickets,
    avgTicketsPerRace: Math.round(totalTickets / validRaces * 100) / 100,
    totalStake,
    hitTickets, hitRaces,
    ticketHitRate, raceHitRate,
    avgOdds: Math.round(avgOdds * 100) / 100,
    medianOdds: Math.round(median(hitOdds) * 100) / 100,
    maxOdds: hitTickets > 0 ? Math.max(...hitOdds) : 0,
    totalReturn, ROI,
    roiExMaxHit: roi1, roiExMax3Hits: roi3,
    year2024ROI: ymROI(ym => ym.startsWith("2024")),
    year2025ROI: ymROI(ym => ym.startsWith("2025")),
    verdict,
  };
}

const results = STRATEGIES.map(evaluate);

// ─── グループ別ランキング ─────────────────────────────────────────────────────

const groups = ["3連単", "3連複", "2連単", "2連複", "拡連複"];

// ─── Markdown ────────────────────────────────────────────────────────────────

const p2 = (v: number) => v.toFixed(2);
const pct = (v: number) => v.toFixed(1) + "%";

let md = `# 有望券種 深掘りストラテジー分析

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

- BUY レース: ${rows.length.toLocaleString()}
- 1点 ${STAKE}円

`;

for (const group of groups) {
  const gs = results.filter(r => r.betType === group).sort((a,b) => b.ROI - a.ROI);
  md += `## ${group}\n\n`;
  md += `| 戦略 | 点数/R | 的中R | R的中率 | T的中率 | ROI | ExMax1 ROI | ExMax3 ROI | 2024ROI | 2025ROI | 判定 |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of gs) {
    md += `| ${r.name.replace(group + ": ", "")} | ${r.avgTicketsPerRace} | ${r.hitRaces} | ${pct(r.raceHitRate)} | ${pct(r.ticketHitRate)} | **${r.ROI}%** | ${r.roiExMaxHit}% | ${r.roiExMax3Hits}% | ${r.year2024ROI}% | ${r.year2025ROI}% | ${r.verdict} |\n`;
  }
  md += "\n";
}

md += `## 全戦略 ROI ランキング

> 的中R: 的中レース数 / R的中率: hitRaces/nRaces / T的中率: hitTickets/totalTickets

| rank | 戦略 | 点数/R | ROI | ExMax1 ROI | R的中率 | T的中率 | 判定 |
|---|---|---|---|---|---|---|---|
${[...results].sort((a,b)=>b.ROI-a.ROI).map((r,i) =>
  `| ${i+1} | ${r.name} | ${r.avgTicketsPerRace} | **${r.ROI}%** | ${r.roiExMaxHit}% | ${pct(r.raceHitRate)} | ${pct(r.ticketHitRate)} | ${r.verdict} |`
).join("\n")}

## 注意事項

- 点数増加戦略は的中率が上がってもROIと資金効率が下がる可能性がある。
- 拡連複は低オッズのため参考扱い。ROI 105未満は実用外。
- ROI は検証指標であり購入推奨ではない。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf-8");

console.log(`[promising] 完了 → ${OUT_MD}`);
console.log(`\nトップ5 ROI:`);
[...results].sort((a,b)=>b.ROI-a.ROI).slice(0,5).forEach((r,i) =>
  console.log(`  ${i+1}. ${r.name}: ROI=${r.ROI}% hitRaces=${r.hitRaces} → ${r.verdict}`)
);
