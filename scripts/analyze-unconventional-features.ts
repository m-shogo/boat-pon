/**
 * 人・移動・F・イベントなどをpoint-in-time順でscreenするread-only分析。
 * 的中率の仮説生成専用。市場差・利益edge・BUY条件とは扱わない。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { staticUnconventionalFlags, type UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";

const db = new DatabaseSync("data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 30000;");

type RaceRow = { race_id: string; date: string; venue: string; race_no: number; raw_json: string; trifecta: string };
type Stat = { n: number; hits: number };
type RacerState = { date: string; venue: string; won: boolean };
type PairState = { meetings: number; lastWinner: string | null; wins: Map<string, number> };

try {
  const races = db.prepare(`
    SELECT op.race_id, op.date, op.venue, op.race_no, op.raw_json, rr.trifecta
    FROM official_programs op
    JOIN race_results rr ON rr.race_id = op.race_id AND rr.returned = 0
    WHERE op.date >= '2024-01-01' AND op.date <= '2025-12-31'
      AND rr.trifecta IS NOT NULL AND rr.trifecta != ''
    ORDER BY op.date, op.venue, op.race_no
  `).all() as RaceRow[];
  const flyingByDate = loadFlyingByDate(db);
  const racerState = new Map<string, RacerState>();
  const recentFlying = new Map<string, string>();
  const pairState = new Map<string, PairState>();
  const stats = new Map<string, Record<string, Stat>>();
  const baseline: Record<string, Stat> = { "2024": { n: 0, hits: 0 }, "2025": { n: 0, hits: 0 } };

  let currentDate = "";
  let pending: Array<{ program: UnconventionalProgram; venue: string; winnerCourse: number }> = [];
  for (const race of races) {
    if (currentDate && race.date !== currentDate) {
      applyDay(currentDate, pending, racerState, recentFlying, pairState, flyingByDate.get(currentDate) ?? []);
      pending = [];
    }
    currentDate = race.date;
    const program = JSON.parse(race.raw_json) as UnconventionalProgram;
    const boats = [...program.boats].sort((a, b) => a.course - b.course);
    const head = boats.find(boat => boat.course === 1);
    if (!head?.registrationNo || boats.length < 6) continue;
    const winnerCourse = Number(race.trifecta.split("-")[0]);
    const hit = winnerCourse === 1;
    const year = race.date.slice(0, 4);
    baseline[year].n += 1;
    if (hit) baseline[year].hits += 1;

    const flags = new Set(staticUnconventionalFlags(program));
    const previous = racerState.get(head.registrationNo);
    if (previous) {
      const days = dayDiff(previous.date, race.date);
      if (days <= 1) flags.add("1号艇連戦_翌日以内");
      if (days <= 1 && previous.venue !== race.venue) flags.add("1号艇短期会場移動");
      if (days <= 1 && previous.venue === race.venue) flags.add("1号艇同場連戦");
      if (previous.won) flags.add("1号艇前走勝利");
    }
    const lastF = recentFlying.get(head.registrationNo);
    if (lastF && dayDiff(lastF, race.date) <= 180) flags.add("1号艇F後180日");
    const recentFOpponents = boats.slice(1).filter(boat => {
      const date = boat.registrationNo ? recentFlying.get(boat.registrationNo) : null;
      return date != null && dayDiff(date, race.date) <= 180;
    }).length;
    if (recentFOpponents >= 2) flags.add("相手にF後が複数");

    const second = boats.find(boat => boat.course === 2);
    if (second?.registrationNo) {
      const pair = pairState.get(pairKey(head.registrationNo, second.registrationNo));
      if (pair?.lastWinner === second.registrationNo) flags.add("1号艇_2号艇への雪辱戦");
      if ((pair?.meetings ?? 0) >= 5) flags.add("1号艇2号艇_顔なじみ");
      if ((pair?.wins.get(head.registrationNo) ?? 0) >= 3 && (pair?.wins.get(second.registrationNo) ?? 0) === 0) flags.add("1号艇_2号艇に過去優勢");
    }
    let familiarity = 0;
    for (let i = 0; i < boats.length; i += 1) for (let j = i + 1; j < boats.length; j += 1) {
      const a = boats[i].registrationNo; const b = boats[j].registrationNo;
      if (a && b) familiarity += pairState.get(pairKey(a, b))?.meetings ?? 0;
    }
    if (familiarity >= 30) flags.add("顔なじみが多いメンバー");

    for (const flag of flags) addStat(stats, flag, year, hit);
    pending.push({ program, venue: race.venue, winnerCourse });
  }
  if (currentDate) applyDay(currentDate, pending, racerState, recentFlying, pairState, flyingByDate.get(currentDate) ?? []);

  const rows = [...stats].map(([feature, years]) => {
    const train = years["2024"] ?? { n: 0, hits: 0 };
    const forward = years["2025"] ?? { n: 0, hits: 0 };
    const trainRate = rate(train); const forwardRate = rate(forward);
    const trainLift = trainRate - rate(baseline["2024"]);
    const forwardLift = forwardRate - rate(baseline["2025"]);
    return { feature, train, forward, trainRate, forwardRate, trainLift, forwardLift,
      stableDirection: train.n >= 200 && forward.n >= 200 && Math.sign(trainLift) === Math.sign(forwardLift) && Math.abs(trainLift) >= 0.02 && Math.abs(forwardLift) >= 0.02 };
  }).sort((a, b) => Math.min(Math.abs(b.trainLift), Math.abs(b.forwardLift)) - Math.min(Math.abs(a.trainLift), Math.abs(a.forwardLift)));
  const stable = rows.filter(row => row.stableDirection);
  const conditionalHoldDefinitions = [
    { feature: "1号艇F後180日", learning: "F歴だけでは慎重化・奮起のどちらも支持できない", retryWhen: "F時期、事故率、ST変化、開催格を事前固定して別検証できる" },
    { feature: "1号艇_2号艇への雪辱戦", learning: "前回敗戦という物語は翌対戦の優位性にならない", retryWhen: "枠、会場、機力、対戦間隔を揃えた十分な標本が得られる" },
    { feature: "相手にF後が複数", learning: "相手のF歴を単純加算しても1号艇優位にはならない", retryWhen: "当節STやスタート展示を含むpoint-in-timeデータが揃う" },
    { feature: "当地覚醒_1号艇", learning: "地元なら覚醒という呼び方と実測方向が合わない", retryWhen: "定義を後付け変更せず当地成績の期待差として再定義する" },
  ];
  const conditionalHold = conditionalHoldDefinitions.flatMap(definition => {
    const row = rows.find(candidate => candidate.feature === definition.feature);
    return row ? [{ ...definition, ...row }] : [];
  });
  const report = {
    generatedAt: new Date().toISOString(), safety: { readOnly: true, pointInTime: true, profitClaim: false, productionConnected: false },
    target: "1号艇1着率。市場残差・ROIではない", baseline, stable, conditionalHold, all: rows,
    unavailable: [
      { feature: "誕生日", status: "公式選手profileに存在するがDB未保存。取得日によらない静的metadataとして追加可能" },
      { feature: "周年・イベント", status: "2024-2025の旧official_programs.raw_jsonにraceTitle/categoryが未保存。今後のforwardで利用可能" },
      { feature: "私的人間関係", status: "信頼できる構造化一次情報なし。噂は使わず過去同走・対戦で代替" },
    ],
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/unconventional-feature-screen.json", `${JSON.stringify(report, null, 2)}\n`);
  const md = [
    "# 変わった角度のpoint-in-time feature screen", "",
    "> 1号艇1着率の仮説生成専用。利益edge・BUY条件ではない。2024→2025で同方向、両年n≥200、lift絶対値≥2ptだけを安定候補とする。", "",
    `baseline: 2024 ${pct(rate(baseline["2024"]))} (n=${baseline["2024"].n}) / 2025 ${pct(rate(baseline["2025"]))} (n=${baseline["2025"].n})`, "",
    "| feature | 2024 n / 率 / lift | 2025 n / 率 / lift |", "|---|---:|---:|",
    ...stable.map(row => `| ${row.feature} | ${row.train.n} / ${pct(row.trainRate)} / ${pp(row.trainLift)} | ${row.forward.n} / ${pct(row.forwardRate)} / ${pp(row.forwardLift)} |`),
    "", "## 未利用", "", "- 誕生日: 公式選手profileに存在するがDB未保存", "- 周年・イベント: 2024-2025旧番組JSONにraceTitle/categoryがなく、forward専用", "- 私的人間関係: 噂は使わず、過去同走・直接対戦で代替", "",
    "## 単独勝率では不採用、edge仮説として保留", "",
    "| 仮説 | 2024 n / lift | 2025 n / lift | 学び | 再検証条件 |", "|---|---:|---:|---|---|",
    ...conditionalHold.map(row => `| ${row.feature} | ${row.train.n} / ${pp(row.trainLift)} | ${row.forward.n} / ${pp(row.forwardLift)} | ${row.learning} | ${row.retryWhen} |`),
    "", "ここで否定したのは特徴単独の1号艇勝率上昇だけで、利益edgeではない。勝率低下も市場が過小評価していれば逆方向のedgeになり得る。仮説を削除せず、定義・期間・標本数・方向・保留理由を残し、T-5市場残差、買い目別相互作用、独立期間で検証する。", "",
  ].join("\n");
  writeFileSync("reports/unconventional-feature-screen.md", md);
  console.log(`races=${races.length} / stable=${stable.length}`);
  for (const row of stable) console.log(`${row.feature}: 2024 ${pp(row.trainLift)} n=${row.train.n} / 2025 ${pp(row.forwardLift)} n=${row.forward.n}`);
} finally { db.close(); }

function loadFlyingByDate(db: DatabaseSync) {
  const rows = db.prepare(`SELECT date, racer_reg FROM race_entries WHERE date >= '2024-01-01' AND date <= '2025-12-31' AND racer_reg IS NOT NULL AND (status_code='F' OR st_flying=1)`).all() as Array<{ date: string; racer_reg: string }>;
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row.date, [...(map.get(row.date) ?? []), row.racer_reg]);
  return map;
}
function applyDay(date: string, races: Array<{ program: UnconventionalProgram; venue: string; winnerCourse: number }>, racerState: Map<string, RacerState>, recentF: Map<string, string>, pairs: Map<string, PairState>, flying: string[]) {
  for (const race of races) {
    const boats = race.program.boats;
    const winner = boats.find(boat => boat.course === race.winnerCourse)?.registrationNo ?? null;
    for (const boat of boats) if (boat.registrationNo) racerState.set(boat.registrationNo, { date, venue: race.venue, won: boat.registrationNo === winner });
    for (let i = 0; i < boats.length; i += 1) for (let j = i + 1; j < boats.length; j += 1) {
      const a = boats[i].registrationNo; const b = boats[j].registrationNo; if (!a || !b) continue;
      const key = pairKey(a, b); const state = pairs.get(key) ?? { meetings: 0, lastWinner: null, wins: new Map<string, number>() };
      state.meetings += 1; state.lastWinner = winner === a || winner === b ? winner : state.lastWinner;
      if (winner === a || winner === b) state.wins.set(winner, (state.wins.get(winner) ?? 0) + 1);
      pairs.set(key, state);
    }
  }
  for (const reg of flying) recentF.set(reg, date);
}
function pairKey(a: string, b: string) { return a < b ? `${a}/${b}` : `${b}/${a}`; }
function dayDiff(from: string, to: string) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000); }
function addStat(stats: Map<string, Record<string, Stat>>, feature: string, year: string, hit: boolean) { const years = stats.get(feature) ?? {}; const s = years[year] ?? { n: 0, hits: 0 }; s.n += 1; if (hit) s.hits += 1; years[year] = s; stats.set(feature, years); }
function rate(stat: Stat) { return stat.n > 0 ? stat.hits / stat.n : 0; }
function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function pp(value: number) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pt`; }
