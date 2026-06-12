/**
 * report-exacta-forward-monitor.ts — 読み取り専用
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作・購入推奨
 *
 * 目的:
 *   exacta market residual sweep で見つけた候補を data/exacta-forward-candidates.json
 *   に固定し、lockedAt 以降の新規レースだけで paper-forward 監視する。
 *
 * 重要:
 *   sweep の held-out / forward は post-hoc 再現性チェックであり、真のfuture validationではない。
 *   このスクリプトは条件を増やさず、固定済み候補だけを監視する。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const CANDIDATES_PATH = "data/exacta-forward-candidates.json";
const OUT_MD = "reports/exacta-forward-monitor.md";
const OUT_JSON = "reports/exacta-forward-monitor.json";
const UNIT = 100;

type CandidateFile = {
  schemaVersion: number;
  description: string;
  lockedAt: string;
  sourceCommit: string;
  sourceReport: string;
  basePopulation: {
    runKind: string;
    decision: string;
    selection: string;
    excludedVenues: string[];
    excludedRaceNos: number[];
    note: string;
  };
  reviewPolicy: {
    nextReviewTriggers: number[];
    rules: string[];
  };
  excludedFromLock: Array<{ id: string; reason: string }>;
  candidates: Candidate[];
};

type Candidate = {
  id: string;
  label: string;
  priority: number;
  status: "pending" | "watch" | "manual-review" | "rejected";
  combo: string;
  filter:
    | { type: "wind_band"; minInclusive: number; maxExclusive: number }
    | { type: "venue"; venue: string }
    | { type: "race_no"; raceNo: number };
  sourceMetrics?: Record<string, unknown>;
  notes?: string[];
};

type RaceRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  wind_speed: number | null;
  combo_count: number;
  overround: number | null;
};

type ComboOddsRow = {
  race_id: string;
  combination: string;
  odds: number;
};

type PayoutRow = {
  race_id: string;
  combination: string;
  payout_yen: number | null;
};

type CandidateStats = {
  id: string;
  label: string;
  priority: number;
  combo: string;
  lockedAt: string;
  matched: number;
  priced: number;
  resolved: number;
  pending: number;
  hit: number;
  actualRate: number | null;
  avgNormalizedImplied: number | null;
  edgePp: number | null;
  avgOdds: number | null;
  realizedRoi: number | null;
  max1hitExcludedRoi: number | null;
  status: "pending" | "reference" | "rejected-watch" | "manual-review" | "paper-continue";
  statusReason: string;
  nextReviewTrigger: number | null;
  monthly: Array<{ month: string; n: number; hit: number; roi: number | null; edgePp: number | null }>;
};

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}
if (!existsSync(CANDIDATES_PATH)) {
  console.error(`candidates not found: ${CANDIDATES_PATH}`);
  process.exit(1);
}

const candidateFile = JSON.parse(readFileSync(CANDIDATES_PATH, "utf8")) as CandidateFile;
validateCandidateFile(candidateFile);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const races = loadBaseRaces(candidateFile);
  const raceIds = races.map((r) => r.race_id);
  const oddsByRace = loadOddsByRace(raceIds);
  const payoutsByRace = loadPayoutsByRace(raceIds);
  const stats = candidateFile.candidates
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((candidate) => aggregateCandidate(candidate, candidateFile.lockedAt, races, oddsByRace, payoutsByRace, candidateFile.reviewPolicy.nextReviewTriggers));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "fixed exacta future monitor",
    warning: "post-hoc sweep候補を固定し、lockedAt以降だけを見る。BUY昇格・app_settings反映・decision logic変更は禁止。",
    lockedAt: candidateFile.lockedAt,
    sourceCommit: candidateFile.sourceCommit,
    sourceReport: candidateFile.sourceReport,
    basePopulation: candidateFile.basePopulation,
    reviewPolicy: candidateFile.reviewPolicy,
    excludedFromLock: candidateFile.excludedFromLock,
    baseRaceCount: races.length,
    candidates: stats,
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));

  console.log(`[report-exacta-forward-monitor] lockedAt=${candidateFile.lockedAt}`);
  console.log(`[report-exacta-forward-monitor] base races=${races.length}`);
  for (const row of stats) {
    console.log(`${row.id}: n=${row.resolved} hit=${row.hit} ROI=${fmtPct(row.realizedRoi)} edge=${fmtPp(row.edgePp)} status=${row.status}`);
  }
  console.log(`[report-exacta-forward-monitor] wrote ${OUT_MD}`);
  console.log(`[report-exacta-forward-monitor] wrote ${OUT_JSON}`);
} finally {
  db.close();
}

function loadBaseRaces(file: CandidateFile): RaceRow[] {
  const venuePlaceholders = file.basePopulation.excludedVenues.map(() => "?").join(",");
  const raceNoPlaceholders = file.basePopulation.excludedRaceNos.map(() => "?").join(",");
  const params = [
    file.basePopulation.runKind,
    file.basePopulation.decision,
    file.basePopulation.selection,
    file.lockedAt,
    ...file.basePopulation.excludedVenues,
    ...file.basePopulation.excludedRaceNos,
  ];
  return db.prepare(`
WITH exacta_overround AS (
  SELECT race_id,
         COUNT(*) AS combo_count,
         SUM(CASE WHEN odds > 0 THEN 1.0 / odds ELSE 0 END) AS overround
  FROM historical_alternative_odds
  WHERE bet_type='exacta'
  GROUP BY race_id
)
SELECT DISTINCT
  dh.race_id,
  dh.date,
  dh.venue,
  dh.race_no,
  rw.wind_speed_mps AS wind_speed,
  COALESCE(eo.combo_count, 0) AS combo_count,
  eo.overround
FROM decision_history dh
LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
LEFT JOIN exacta_overround eo ON eo.race_id = dh.race_id
WHERE dh.run_kind = ?
  AND dh.decision = ?
  AND dh.selection = ?
  AND dh.current_odds IS NOT NULL
  AND dh.result IS NOT NULL
  AND dh.result != ''
  AND dh.date >= ?
  AND dh.venue NOT IN (${venuePlaceholders})
  AND dh.race_no NOT IN (${raceNoPlaceholders})
  AND NOT EXISTS (
    SELECT 1 FROM race_entries re
    WHERE re.race_id = dh.race_id AND re.status_code = 'F'
  )
ORDER BY dh.date, dh.venue, dh.race_no
`).all(...params) as RaceRow[];
}

function loadOddsByRace(raceIds: string[]) {
  const map = new Map<string, Map<string, number>>();
  for (const ids of chunks(raceIds, 500)) {
    if (!ids.length) continue;
    const rows = db.prepare(`
SELECT race_id, combination, odds
FROM historical_alternative_odds
WHERE bet_type='exacta'
  AND race_id IN (${ids.map(() => "?").join(",")})
`).all(...ids) as ComboOddsRow[];
    for (const row of rows) {
      const byCombo = map.get(row.race_id) ?? new Map<string, number>();
      byCombo.set(row.combination, Number(row.odds));
      map.set(row.race_id, byCombo);
    }
  }
  return map;
}

function loadPayoutsByRace(raceIds: string[]) {
  const map = new Map<string, PayoutRow[]>();
  for (const ids of chunks(raceIds, 500)) {
    if (!ids.length) continue;
    const rows = db.prepare(`
SELECT race_id, combination, payout_yen
FROM race_payouts
WHERE bet_type='exacta'
  AND race_id IN (${ids.map(() => "?").join(",")})
`).all(...ids) as PayoutRow[];
    for (const row of rows) {
      const list = map.get(row.race_id) ?? [];
      list.push(row);
      map.set(row.race_id, list);
    }
  }
  return map;
}

function aggregateCandidate(
  candidate: Candidate,
  lockedAt: string,
  races: RaceRow[],
  oddsByRace: Map<string, Map<string, number>>,
  payoutsByRace: Map<string, PayoutRow[]>,
  reviewTriggers: number[],
): CandidateStats {
  const matched = races.filter((race) => matchesCandidate(candidate, race));
  const pricedRows = matched.filter((race) => {
    const odds = oddsByRace.get(race.race_id)?.get(candidate.combo);
    return race.combo_count === 30 && race.overround != null && race.overround > 0 && odds != null && odds > 0;
  });
  const resolvedRows = pricedRows.filter((race) => (payoutsByRace.get(race.race_id)?.length ?? 0) > 0);
  const pending = matched.length - resolvedRows.length;

  let hit = 0;
  let payout = 0;
  let totalImplied = 0;
  let totalOdds = 0;
  const hitPayouts: number[] = [];
  const monthlyMap = new Map<string, { races: RaceRow[] }>();

  for (const race of resolvedRows) {
    const odds = oddsByRace.get(race.race_id)?.get(candidate.combo);
    if (odds != null && race.overround != null && race.overround > 0) {
      totalImplied += (1 / odds) / race.overround;
      totalOdds += odds;
    }
    const rows = payoutsByRace.get(race.race_id) ?? [];
    const win = rows.find((row) => row.combination === candidate.combo);
    if (win) {
      hit += 1;
      const amount = Number(win.payout_yen ?? 0);
      payout += amount;
      hitPayouts.push(amount);
    }
    const month = race.date.slice(0, 7);
    const bucket = monthlyMap.get(month) ?? { races: [] };
    bucket.races.push(race);
    monthlyMap.set(month, bucket);
  }

  const n = resolvedRows.length;
  const actualRate = n ? hit / n : null;
  const avgImplied = n ? totalImplied / n : null;
  const edgePp = actualRate != null && avgImplied != null ? (actualRate - avgImplied) * 100 : null;
  const roi = n ? payout / (n * UNIT) : null;
  const max1hitExcludedRoi = n ? maxHitExcludedRoi(hitPayouts, payout, n) : null;
  const status = judgeStatus(n, hit, roi, max1hitExcludedRoi, edgePp);
  const monthly = [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, bucket]) => {
    const subset = bucket.races;
    let monthHit = 0;
    let monthPayout = 0;
    let monthImplied = 0;
    for (const race of subset) {
      const odds = oddsByRace.get(race.race_id)?.get(candidate.combo);
      if (odds != null && race.overround != null && race.overround > 0) monthImplied += (1 / odds) / race.overround;
      const win = (payoutsByRace.get(race.race_id) ?? []).find((row) => row.combination === candidate.combo);
      if (win) {
        monthHit += 1;
        monthPayout += Number(win.payout_yen ?? 0);
      }
    }
    const monthActual = subset.length ? monthHit / subset.length : null;
    const monthAvgImplied = subset.length ? monthImplied / subset.length : null;
    return {
      month,
      n: subset.length,
      hit: monthHit,
      roi: subset.length ? monthPayout / (subset.length * UNIT) : null,
      edgePp: monthActual != null && monthAvgImplied != null ? (monthActual - monthAvgImplied) * 100 : null,
    };
  });

  return {
    id: candidate.id,
    label: candidate.label,
    priority: candidate.priority,
    combo: candidate.combo,
    lockedAt,
    matched: matched.length,
    priced: pricedRows.length,
    resolved: n,
    pending,
    hit,
    actualRate,
    avgNormalizedImplied: avgImplied,
    edgePp,
    avgOdds: n ? totalOdds / n : null,
    realizedRoi: roi,
    max1hitExcludedRoi,
    status: status.status,
    statusReason: status.reason,
    nextReviewTrigger: nextReviewTrigger(n, reviewTriggers),
    monthly,
  };
}

function matchesCandidate(candidate: Candidate, race: RaceRow) {
  const filter = candidate.filter;
  if (filter.type === "venue") return race.venue === filter.venue;
  if (filter.type === "race_no") return race.race_no === filter.raceNo;
  if (filter.type === "wind_band") {
    return race.wind_speed != null && race.wind_speed >= filter.minInclusive && race.wind_speed < filter.maxExclusive;
  }
  return false;
}

function judgeStatus(
  n: number,
  hit: number,
  roi: number | null,
  max1hitRoi: number | null,
  edgePp: number | null,
): { status: CandidateStats["status"]; reason: string } {
  if (n < 30) return { status: "pending", reason: "forward n < 30 のため評価しない" };
  if (hit < 3) return { status: "reference", reason: "n >= 30 だが hit < 3 のため参考扱い" };
  if (n >= 50 && roi != null && roi < 0.9) return { status: "rejected-watch", reason: "n >= 50 かつ ROI < 90% のため rejected寄り" };
  if (n >= 100 && roi != null && max1hitRoi != null && edgePp != null && roi > 1.05 && max1hitRoi > 0.95 && edgePp > 0) {
    return { status: "manual-review", reason: "n >= 100 かつ ROI > 105%、max1hit > 95%、edge_pp > 0。BUY昇格ではなく手動レビュー" };
  }
  return { status: "paper-continue", reason: "paper継続。条件追加やBUY昇格はしない" };
}

function nextReviewTrigger(n: number, triggers: number[]) {
  return triggers.find((trigger) => n < trigger) ?? null;
}

function maxHitExcludedRoi(hitPayouts: number[], totalPayout: number, n: number) {
  if (n <= 0) return null;
  if (!hitPayouts.length) return 0;
  const maxPayout = Math.max(...hitPayouts);
  return (totalPayout - maxPayout) / (n * UNIT);
}

function renderMarkdown(report: {
  generatedAt: string;
  warning: string;
  lockedAt: string;
  sourceCommit: string;
  sourceReport: string;
  basePopulation: CandidateFile["basePopulation"];
  reviewPolicy: CandidateFile["reviewPolicy"];
  excludedFromLock: CandidateFile["excludedFromLock"];
  baseRaceCount: number;
  candidates: CandidateStats[];
}) {
  const lines: string[] = [];
  lines.push("# exacta forward monitor");
  lines.push("");
  lines.push(`生成日時: ${report.generatedAt}`);
  lines.push("");
  lines.push(`> **${report.warning}**`);
  lines.push("> **これは購入指示ではありません。BUY昇格・app_settings反映・decision logic変更・自動投票は禁止。**");
  lines.push("");
  lines.push("## 固定条件");
  lines.push("");
  lines.push(`- lockedAt: ${report.lockedAt}`);
  lines.push(`- sourceCommit: ${report.sourceCommit}`);
  lines.push(`- sourceReport: ${report.sourceReport}`);
  lines.push(`- baseRaceCount since lockedAt: ${report.baseRaceCount}`);
  lines.push(`- basePopulation: run_kind=${report.basePopulation.runKind}, decision=${report.basePopulation.decision}, selection=${report.basePopulation.selection}`);
  lines.push(`- excludedVenues: ${report.basePopulation.excludedVenues.join(", ")}`);
  lines.push(`- excludedRaceNos: ${report.basePopulation.excludedRaceNos.join(", ")}`);
  lines.push("");
  lines.push("## Review Policy");
  lines.push("");
  for (const rule of report.reviewPolicy.rules) lines.push(`- ${rule}`);
  lines.push("");
  lines.push("## Candidates");
  lines.push("");
  lines.push("| candidate | lockedAt | matched | forward n | hit | actual | implied | edge_pp | ROI | max1x ROI | nextReview | status |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const row of report.candidates) {
    lines.push(`| ${row.label} | ${row.lockedAt} | ${row.matched} | ${row.resolved} | ${row.hit} | ${fmtPct(row.actualRate)} | ${fmtPct(row.avgNormalizedImplied)} | ${fmtPp(row.edgePp)} | ${fmtPct(row.realizedRoi)} | ${fmtPct(row.max1hitExcludedRoi)} | ${row.nextReviewTrigger ?? "-"} | ${row.status} |`);
  }
  lines.push("");
  lines.push("## Status Reasons");
  lines.push("");
  for (const row of report.candidates) lines.push(`- ${row.id}: ${row.statusReason}`);
  lines.push("");
  lines.push("## Excluded From Lock");
  lines.push("");
  for (const row of report.excludedFromLock) lines.push(`- ${row.id}: ${row.reason}`);
  lines.push("");
  lines.push("## Monthly Detail");
  lines.push("");
  for (const row of report.candidates) {
    lines.push(`### ${row.label}`);
    lines.push("");
    if (!row.monthly.length) {
      lines.push("- lockedAt以降の確定済み対象レースなし");
      lines.push("");
      continue;
    }
    lines.push("| month | n | hit | ROI | edge_pp |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const month of row.monthly) {
      lines.push(`| ${month.month} | ${month.n} | ${month.hit} | ${fmtPct(month.roi)} | ${fmtPp(month.edgePp)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function validateCandidateFile(file: CandidateFile) {
  if (file.schemaVersion !== 1) throw new Error(`unsupported schemaVersion: ${file.schemaVersion}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(file.lockedAt)) throw new Error(`lockedAt must be YYYY-MM-DD: ${file.lockedAt}`);
  const ids = new Set<string>();
  for (const candidate of file.candidates) {
    if (ids.has(candidate.id)) throw new Error(`duplicated candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    if (!/^[1-6]-[1-6]$/.test(candidate.combo)) throw new Error(`invalid exacta combo: ${candidate.id} ${candidate.combo}`);
    const [a, b] = candidate.combo.split("-");
    if (a === b) throw new Error(`invalid exacta combo with duplicated boat: ${candidate.id} ${candidate.combo}`);
  }
}

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function fmtPct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(1)}%`;
}

function fmtPp(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : `${value.toFixed(2)}pt`;
}
