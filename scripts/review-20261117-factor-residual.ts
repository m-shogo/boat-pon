/**
 * 選手の事情（枠・場・相性・F 持ち・地元・節の重み）が、締切5分前の市場に織り込まれているかを測る。
 * 事前登録: docs/reviews/2026-11-17-factor-residual-screening.md。読み取りだけ・stdout のみ（用途: 監査・精度）。
 *
 * 物差し: 事情を持つ艇の「実際の 1着の数 ÷ 市場が見込んだ 1着の数」。1 なら織り込み済み。
 *
 * 実行（本番の作業コピーで）: npx tsx scripts/review-20261117-factor-residual.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--split YYYY-MM-DD]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { calibratedMarketProbabilities } from "../src/domain/accuracyScorecard";
import { addDays, loadChampionCalibration, loadCompleteCaptures } from "./lib/marketCaptures";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const FROM = arg("--from", "2026-07-01");
const TO = arg("--to", "2026-11-15");
const SPLIT = arg("--split", "2026-09-01"); // この日から後半
const LANE_FROM = "2024-01-01";
const H2H_FROM = "2023-01-01";
const t0 = Date.now();
const log = (message: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${message}`);
const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "file:data/boat.sqlite?mode=ro", { readOnly: true });

// ─── 市場（締切5分前の市場補正の確率を 1着ごとに足す）と確定した 1着 ───
type ProgramBoat = { course: number; registrationNo?: string; className?: string; nationalWinRate?: number; localWinRate?: number };
type EvalRace = { raceId: string; date: string; venue: string; marketWin: number[]; winner: number; boats: ProgramBoat[]; drift: number | null };
const { t5, t10, t20 } = loadCompleteCaptures(db, FROM, TO);
const champion = loadChampionCalibration();
log(`締切5分前の完全な市場 ${t5.size} レース`);
const programs = new Map<string, { date: string; venue: string; boats: ProgramBoat[] }>();
const classByStart = new Map<string, string>(); // `${raceId}|${枠}` → 級別（枠の基準を作るため。2024-01〜）
for (const r of db.prepare("SELECT race_id, date, venue, raw_json FROM official_programs WHERE date >= ? AND date <= ?").iterate(LANE_FROM, TO) as Iterable<{ race_id: string; date: string; venue: string; raw_json: string }>) {
  let boats: ProgramBoat[] = [];
  try { boats = (JSON.parse(r.raw_json) as { boats?: ProgramBoat[] }).boats ?? []; } catch { continue; }
  for (const b of boats) if (b.className) classByStart.set(`${r.race_id}|${b.course}`, b.className);
  if (r.date >= FROM) programs.set(r.race_id, { date: r.date, venue: r.venue, boats });
}
log(`番組表 ${programs.size} レース（評価の期間）・級別 ${classByStart.size} 走`);
const evalRaces = new Map<string, EvalRace>();
for (const r of db.prepare("SELECT race_id, trifecta, payout_yen FROM race_results WHERE date >= ? AND date <= ? AND trifecta IS NOT NULL").all(FROM, TO) as Array<{ race_id: string; trifecta: string; payout_yen: number | null }>) {
  const odds = t5.get(r.race_id);
  const program = programs.get(r.race_id);
  if (!odds || !program || !/^[1-6]-[1-6]-[1-6]$/.test(r.trifecta)) continue;
  if (program.boats.length !== 6 || new Set(program.boats.map((b) => b.course)).size !== 6) continue;
  const p = calibratedMarketProbabilities(odds, t10.get(r.race_id) ?? t20.get(r.race_id) ?? null, champion);
  if (!p) continue;
  const marketWin = [0, 0, 0, 0, 0, 0];
  for (const [selection, prob] of p) marketWin[Number(selection[0]) - 1] += prob;
  if (marketWin.some((v) => !(v > 0))) continue;
  // 当たった買い目の、確定の払戻 ÷ 締切5分前のオッズ（対数）。締切までの資金の動きを見るため
  const o5 = odds.get(r.trifecta);
  const drift = o5 != null && o5 > 0 && r.payout_yen != null && r.payout_yen > 0 ? Math.log(r.payout_yen / 100 / o5) : null;
  evalRaces.set(r.race_id, { raceId: r.race_id, date: program.date, venue: program.venue, marketWin, winner: Number(r.trifecta[0]), boats: [...program.boats].sort((a, b) => a.course - b.course), drift });
}
log(`評価するレース ${evalRaces.size}`);

// ─── 番組表の元ファイル（B ファイル）から、支部と節の名前（手元のファイルだけ。DB には無い） ───
const LOCAL_BRANCH: Record<string, string> = {
  桐生: "群馬", 戸田: "埼玉", 江戸川: "東京", 平和島: "東京", 多摩川: "東京", 浜名湖: "静岡", 蒲郡: "愛知", 常滑: "愛知", 津: "三重",
  三国: "福井", びわこ: "滋賀", 住之江: "大阪", 尼崎: "兵庫", 鳴門: "徳島", 丸亀: "香川", 児島: "岡山", 宮島: "広島", 徳山: "山口", 下関: "山口",
  若松: "福岡", 芦屋: "福岡", 福岡: "福岡", 唐津: "佐賀", 大村: "長崎",
};
const branchByRacerDay = new Map<string, string>(); // `${date}|${登番}` → 支部
const titleByRacerDay = new Map<string, string>(); // `${date}|${登番}` → 節の名前
{
  const tmp = mkdtempSync(path.join(tmpdir(), "boatpon-bfile-"));
  let files = 0;
  for (let date = FROM; date <= TO; date = addDays(date, 1)) {
    const yymmdd = date.slice(2).replaceAll("-", "");
    const lzh = path.join("data", "raw", "official", "programs", `b${yymmdd}.lzh`);
    if (!existsSync(lzh)) continue;
    const txtPath = path.join(tmp, `B${yymmdd}.TXT`);
    try {
      execFileSync("unar", ["-q", "-o", tmp, "-f", lzh]);
      const lines = new TextDecoder("shift_jis").decode(readFileSync(txtPath)).split(/\r?\n/);
      let title = "", expectTitle = false;
      for (const line of lines) {
        if (line.includes("番組表")) { expectTitle = true; continue; }
        if (expectTitle && line.trim()) { title = line.replace(/[\s　]/g, ""); expectTitle = false; continue; }
        const m = line.match(/^([1-6]) (\d{4})(.+?)(\d{2})(\S{2})(\d{2})([AB][12])/);
        if (!m) continue;
        branchByRacerDay.set(`${date}|${m[2]}`, m[5]);
        titleByRacerDay.set(`${date}|${m[2]}`, title);
      }
      files += 1;
    } catch { /* 読めない日は、支部・節の名前なしで数える */ } finally { try { rmSync(txtPath); } catch { /* */ } }
  }
  rmSync(tmp, { recursive: true, force: true });
  log(`B ファイル ${files} 日分（支部 ${branchByRacerDay.size} 走）`);
}

// ─── レースの種類 ───
const raceTypeById = new Map((db.prepare("SELECT race_id, race_type FROM race_conditions WHERE date >= ? AND date <= ?").all(FROM, TO) as Array<{ race_id: string; race_type: string | null }>).map((r) => [r.race_id, r.race_type ?? ""]));
const raceGroup = (type: string) => /準優/.test(type) ? "準優勝戦" : /優勝戦/.test(type) ? "優勝戦" : /予選/.test(type) ? "予選" : /選抜|特選|特賞|ドリーム/.test(type) ? "選抜・特選など" : /一般/.test(type) ? "一般" : "そのほか";

// ─── 過去の成績を日付の順にたどり、その日より前の記録だけで事情を作る ───
type Entry = { race_id: string; date: string; boat: number; finish_pos: number | null; status_code: string | null; racer_reg: string | null };
const history = db.prepare("SELECT race_id, date, boat, finish_pos, status_code, racer_reg FROM race_entries WHERE date >= ? AND date <= ? ORDER BY date, race_id").all(H2H_FROM, TO) as Entry[];
log(`過去の成績 ${history.length} 走（${H2H_FROM}〜）`);
const racerLane = new Map<string, number[]>(); // `${登番}|${枠}` → [走, 1着]
const classLane = new Map<string, number[]>(); // `${級別}|${枠}` → [走, 1着]
const racerLaneLag = new Map<string, number[]>(), classLaneLag = new Map<string, number[]>(); // 30 日より前の成績だけで作る版（先取りが混ざっていないかの確認用）
const lagQueue: Entry[][] = [];
const venueLane = new Map<string, number[]>(); // `${場}|${枠}` → [走, 1着]（その場でその枠がどれだけ勝つか）
const allLane = new Map<string, number[]>(); // 枠 → [走, 1着]
const pair = new Map<string, number[]>(); // `${a}|${b}`（a < b）→ [a が先着, b が先着]
const fDates = new Map<string, string[]>(); // 登番 → F の日付
const bump = (map: Map<string, number[]>, key: string, i: number) => { const v = map.get(key) ?? [0, 0]; v[i] += 1; map.set(key, v); };
const periodStart = (date: string) => { const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))]; return m >= 11 ? `${y}-11-01` : m >= 5 ? `${y}-05-01` : `${y - 1}-11-01`; };

type Obs = { date: string; p: number; win: 0 | 1; tags: string[]; lane?: number; h2h?: number; raceId: string; course: number; venueDiff?: number; fCount: number; local: boolean; branchKnown: boolean; national: number; venue: string; venueLane: number; drift: number | null; laneLag?: number };
const observations: Obs[] = [];
function evaluate(race: EvalRace) {
  const type = raceGroup(raceTypeById.get(race.raceId) ?? "");
  const favorite = race.marketWin.indexOf(Math.max(...race.marketWin));
  const regs = race.boats.map((b) => b.registrationNo ?? "");
  const title = titleByRacerDay.get(`${race.date}|${regs[0]}`) ?? "";
  const anniversary = /周年/.test(title);
  race.boats.forEach((boat, i) => {
    const reg = regs[i];
    const tags: string[] = [];
    const obs: Obs = { date: race.date, p: race.marketWin[i], win: race.winner === boat.course ? 1 : 0, tags, raceId: race.raceId, course: boat.course, fCount: 0, local: false, branchKnown: false, venue: race.venue, drift: race.drift, venueLane: (() => { const v = venueLane.get(`${race.venue}|${boat.course}`), g = allLane.get(String(boat.course)); return v && g && v[0] >= 300 && v[1] > 0 && g[1] > 0 ? Math.log(v[1] / v[0]) - Math.log(g[1] / g[0]) : 0; })(), national: (boat.nationalWinRate ?? 0) - race.boats.reduce((sum, b) => sum + (b.nationalWinRate ?? 0), 0) / 6 };
    // 1. 枠の得意・苦手（上位・下位 2 割は、全部の艇を集めてから決める）
    const mine = racerLane.get(`${reg}|${boat.course}`);
    const base = classLane.get(`${boat.className}|${boat.course}`);
    if (reg && mine && mine[0] >= 20 && base && base[0] >= 200) obs.lane = mine[1] / mine[0] - base[1] / base[0];
    const mineLag = racerLaneLag.get(`${reg}|${boat.course}`), baseLag = classLaneLag.get(`${boat.className}|${boat.course}`);
    if (reg && mineLag && mineLag[0] >= 20 && baseLag && baseLag[0] >= 200) obs.laneLag = mineLag[1] / mineLag[0] - baseLag[1] / baseLag[0];
    // 2. 場の得意・苦手
    if (boat.localWinRate != null && boat.localWinRate > 0 && boat.nationalWinRate != null) {
      const diff = boat.localWinRate - boat.nationalWinRate;
      obs.venueDiff = diff;
      if (diff >= 1.0) tags.push("2 場が得意（当地−全国 +1.0 以上）");
      else if (diff <= -1.0) tags.push("2 場が苦手（当地−全国 −1.0 以下）");
      else tags.push("2 場はふつう");
    }
    // 3. 相手との相性
    let meetings = 0, ahead = 0;
    regs.forEach((other, j) => {
      if (j === i || !reg || !other) return;
      const v = reg < other ? pair.get(`${reg}|${other}`) : pair.get(`${other}|${reg}`);
      if (!v) return;
      meetings += v[0] + v[1];
      ahead += reg < other ? v[0] : v[1];
    });
    if (meetings >= 15) obs.h2h = ahead / meetings;
    // 4. フライング持ち
    if (reg) {
      const start = periodStart(race.date);
      const f = (fDates.get(reg) ?? []).filter((d) => d >= start && d < race.date).length;
      tags.push(f === 0 ? "4 F なし" : f === 1 ? "4 F 1 本" : "4 F 2 本以上");
      obs.fCount = f;
    }
    // 5. 地元
    const branch = branchByRacerDay.get(`${race.date}|${reg}`);
    const local = branch != null && branch === LOCAL_BRANCH[race.venue];
    if (branch != null) tags.push(local ? "5 地元" : "5 地元ではない");
    obs.local = local; obs.branchKnown = branch != null;
    // 6. 節・レースの重み（人気の艇・1号艇の当たり方で見る）
    if (i === favorite) tags.push(`6 人気の艇｜${type}`);
    if (boat.course === 1) tags.push(`6 1号艇｜${type}`);
    if (title) {
      if (i === favorite) tags.push(anniversary ? "6 人気の艇｜周年の節" : "6 人気の艇｜周年ではない節");
      if (anniversary && branch != null) tags.push(local ? "6 周年の節の地元の艇" : "6 周年の節の地元ではない艇");
    }
    // 対照: 市場の確率の帯
    tags.push(`0 市場の確率 ${obs.p < 0.05 ? "① 5% 未満" : obs.p < 0.1 ? "② 5〜10%" : obs.p < 0.2 ? "③ 10〜20%" : obs.p < 0.4 ? "④ 20〜40%" : obs.p < 0.6 ? "⑤ 40〜60%" : "⑥ 60% 以上"}`);
    observations.push(obs);
  });
}
function update(entries: Entry[]) {
  const date = entries[0].date;
  if (date >= LANE_FROM) {
    for (const e of entries) {
      if (!e.racer_reg) continue;
      const win = e.finish_pos === 1 ? 1 : 0;
      bump(racerLane, `${e.racer_reg}|${e.boat}`, 0); if (win) bump(racerLane, `${e.racer_reg}|${e.boat}`, 1);
      const venue = e.race_id.split("-")[1];
      bump(venueLane, `${venue}|${e.boat}`, 0); bump(allLane, String(e.boat), 0);
      if (win) { bump(venueLane, `${venue}|${e.boat}`, 1); bump(allLane, String(e.boat), 1); }
      const cls = classByStart.get(`${e.race_id}|${e.boat}`);
      if (cls) { bump(classLane, `${cls}|${e.boat}`, 0); if (win) bump(classLane, `${cls}|${e.boat}`, 1); }
    }
  }
  for (const e of entries) if (e.racer_reg && e.status_code === "F") fDates.set(e.racer_reg, [...(fDates.get(e.racer_reg) ?? []), date]);
  for (let i = 0; i < entries.length; i += 1) for (let j = i + 1; j < entries.length; j += 1) {
    const [a, b] = [entries[i], entries[j]];
    if (!a.racer_reg || !b.racer_reg || a.racer_reg === b.racer_reg) continue;
    const [pa, pb] = [a.finish_pos ?? 99, b.finish_pos ?? 99];
    if (pa === pb) continue; // どちらも完走していない・同着は数えない
    const aAhead = pa < pb;
    if (a.racer_reg < b.racer_reg) bump(pair, `${a.racer_reg}|${b.racer_reg}`, aAhead ? 0 : 1);
    else bump(pair, `${b.racer_reg}|${a.racer_reg}`, aAhead ? 1 : 0);
  }
}
{
  // 日ごとにまとめ、その日のレースを評価してから、その日の成績を足す（同じ日の成績は使わない）
  let i = 0;
  while (i < history.length) {
    const date = history[i].date;
    let j = i;
    const byRace = new Map<string, Entry[]>();
    while (j < history.length && history[j].date === date) { const list = byRace.get(history[j].race_id) ?? []; list.push(history[j]); byRace.set(history[j].race_id, list); j += 1; }
    // 30 日より前の日の成績を、遅れて足す
    while (lagQueue.length && lagQueue[0][0].date <= addDays(date, -30)) {
      for (const e of lagQueue.shift()!) {
        if (!e.racer_reg || e.date < LANE_FROM) continue;
        const win = e.finish_pos === 1 ? 1 : 0;
        bump(racerLaneLag, `${e.racer_reg}|${e.boat}`, 0); if (win) bump(racerLaneLag, `${e.racer_reg}|${e.boat}`, 1);
        const cls = classByStart.get(`${e.race_id}|${e.boat}`);
        if (cls) { bump(classLaneLag, `${cls}|${e.boat}`, 0); if (win) bump(classLaneLag, `${cls}|${e.boat}`, 1); }
      }
    }
    if (date >= FROM) for (const raceId of byRace.keys()) { const race = evalRaces.get(raceId); if (race) evaluate(race); }
    for (const entries of byRace.values()) update(entries);
    lagQueue.push([...byRace.values()].flat());
    i = j;
  }
}
db.close();
log(`評価した艇 ${observations.length}（${observations.length / 6} レース）`);

// 上位・下位 2 割（1・3）を決める
const quintile = (key: "lane" | "h2h", labels: [string, string, string]) => {
  const values = observations.map((o) => o[key]).filter((v): v is number => v != null).sort((a, b) => a - b);
  const lo = values[Math.floor(values.length * 0.2)], hi = values[Math.floor(values.length * 0.8)];
  for (const o of observations) { const v = o[key]; if (v == null) continue; o.tags.push(v >= hi ? labels[0] : v <= lo ? labels[2] : labels[1]); }
  return { n: values.length, lo, hi };
};
const laneCut = quintile("lane", ["1 枠が得意（上位 2 割）", "1 枠はふつう", "1 枠が苦手（下位 2 割）"]);
const h2hCut = quintile("h2h", ["3 相手に分がいい（上位 2 割）", "3 相性はふつう", "3 相手に分が悪い（下位 2 割）"]);
log(`枠の得意度の境目 ${laneCut.lo.toFixed(3)} / ${laneCut.hi.toFixed(3)}（${laneCut.n} 艇）・相性の境目 ${h2hCut.lo.toFixed(3)} / ${h2hCut.hi.toFixed(3)}（${h2hCut.n} 艇）`);

// ─── 集計 ───
type Sum = { n: number; expected: number; wins: number; variance: number };
const empty = (): Sum => ({ n: 0, expected: 0, wins: 0, variance: 0 });
const add = (s: Sum, o: Obs) => { s.n += 1; s.expected += o.p; s.wins += o.win; s.variance += o.p * (1 - o.p); };
const all = new Map<string, { total: Sum; first: Sum; second: Sum }>();
for (const o of observations) for (const tag of o.tags) {
  const g = all.get(tag) ?? { total: empty(), first: empty(), second: empty() };
  add(g.total, o); add(o.date < SPLIT ? g.first : g.second, o);
  all.set(tag, g);
}
const ratio = (s: Sum) => (s.expected > 0 ? s.wins / s.expected : NaN);
console.log(`\n期間 ${FROM}〜${TO}（前半は ${SPLIT} より前）・${observations.length / 6} レース`);
console.log("| 事情 | 艇 | 見込みの 1着 | 実際の 1着 | 実際 ÷ 見込み | 標準誤差 | 何倍 | 前半 | 後半 | 判定 |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const [tag, g] of [...all].sort(([a], [b]) => a.localeCompare(b, "ja"))) {
  const r = ratio(g.total), se = Math.sqrt(g.total.variance) / g.total.expected, z = (r - 1) / se;
  const sameSide = (ratio(g.first) - 1) * (ratio(g.second) - 1) > 0;
  const verdict = g.total.expected < 100 ? "少なくて判定しない" : Math.abs(z) >= 2 && sameSide ? "**兆しあり**" : Math.abs(z) >= 2 ? "前半と後半で向きが逆" : "織り込み済み";
  console.log(`| ${tag} | ${g.total.n} | ${g.total.expected.toFixed(1)} | ${g.total.wins} | ${r.toFixed(3)} | ${se.toFixed(3)} | ${z >= 0 ? "+" : ""}${z.toFixed(1)} | ${ratio(g.first).toFixed(3)} | ${ratio(g.second).toFixed(3)} | ${verdict} |`);
}

// ─── 追加の確認（事前登録の外。上の表を読むための対照） ───
// 上の表は、市場の確率の帯と枠の癖（人気の艇・1号艇は見込みより勝つ）が混ざる。そこで、6艇の中の 1着を
// 「市場の確率の対数 + 枠」で合わせ直した上で、事情を 1 つずつ足し、その係数が 0 から離れているかを見る（条件付きロジット）。
type Row = { x: number[]; win: 0 | 1 };
const races = new Map<string, Obs[]>();
for (const o of observations) { const list = races.get(o.raceId) ?? []; list.push(o); races.set(o.raceId, list); }
const sd = (values: number[]) => { const m = values.reduce((a, b) => a + b, 0) / values.length; return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length) || 1; };
const laneSd = new Map<number, number>();
for (let lane = 1; lane <= 6; lane += 1) laneSd.set(lane, sd(observations.filter((o) => o.course === lane && o.lane != null).map((o) => o.lane!)));
const baseX = (o: Obs) => [Math.log(o.p), ...[2, 3, 4, 5, 6].map((lane) => (o.course === lane ? 1 : 0))];
const FACTORS: Array<{ label: string; value: (o: Obs) => number }> = [
  { label: "1 枠の得意度（その枠の中での標準偏差 1 つ分）", value: (o) => (o.lane == null ? 0 : o.lane / laneSd.get(o.course)!) },
  { label: "2 当地勝率 − 全国勝率（1.0 あたり）", value: (o) => o.venueDiff ?? 0 },
  { label: "3 相手に先着した割合（0.1 あたり）", value: (o) => (o.h2h == null ? 0 : (o.h2h - 0.5) * 10) },
  { label: "4 F 1 本以上", value: (o) => (o.fCount >= 1 ? 1 : 0) },
  { label: "5 地元", value: (o) => (o.local ? 1 : 0) },
];
function fit(groups: Row[][], k: number): { beta: number[]; se: number[]; logloss: number } {
  let beta = new Array(k).fill(0);
  let hessian: number[][] = [];
  for (let iter = 0; iter < 25; iter += 1) {
    const grad = new Array(k).fill(0);
    hessian = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const rows of groups) {
      const scores = rows.map((r) => r.x.reduce((s, v, i) => s + v * beta[i], 0));
      const max = Math.max(...scores);
      const e = scores.map((v) => Math.exp(v - max));
      const sum = e.reduce((a, b) => a + b, 0);
      const q = e.map((v) => v / sum);
      const mean = new Array(k).fill(0);
      rows.forEach((r, i) => r.x.forEach((v, j) => { mean[j] += q[i] * v; }));
      rows.forEach((r, i) => {
        for (let a = 0; a < k; a += 1) {
          if (r.win) grad[a] += r.x[a] - mean[a];
          for (let b = 0; b < k; b += 1) hessian[a][b] += q[i] * (r.x[a] - mean[a]) * (r.x[b] - mean[b]);
        }
      });
    }
    const step = solve(hessian, grad);
    beta = beta.map((v, i) => v + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  const inverse = invert(hessian);
  let ll = 0;
  for (const rows of groups) {
    const scores = rows.map((r) => r.x.reduce((s, v, i) => s + v * beta[i], 0));
    const max = Math.max(...scores);
    const logSum = max + Math.log(scores.reduce((s, v) => s + Math.exp(v - max), 0));
    ll += scores[rows.findIndex((r) => r.win)] - logSum;
  }
  return { beta, se: inverse.map((row, i) => Math.sqrt(row[i])), logloss: -ll / groups.length };
}
function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j += 1) a[c][j] /= d;
    for (let r = 0; r < n; r += 1) if (r !== c) { const f = a[r][c]; for (let j = 0; j < 2 * n; j += 1) a[r][j] -= f * a[c][j]; }
  }
  return a.map((row) => row.slice(n));
}
const solve = (m: number[][], v: number[]) => invert(m).map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
const groupsFor = (extra: ((o: Obs) => number) | null, filter: (date: string) => boolean): Row[][] =>
  [...races.values()].filter((list) => list.length === 6 && list.filter((o) => o.win).length === 1 && filter(list[0].date))
    .map((list) => list.map((o) => ({ x: extra ? [...baseX(o), extra(o)] : baseX(o), win: o.win })));
const everything = () => true;
const base = fit(groupsFor(null, everything), 6);
console.log(`\n追加の確認（事前登録の外）: 1着を「市場の確率の対数 + 枠」で合わせ直し、事情を 1 つずつ足す。${groupsFor(null, everything).length} レース`);
console.log(`土台: 市場の確率の対数の係数 ${base.beta[0].toFixed(3)}（1 なら市場どおり）・枠 2〜6 の係数 ${base.beta.slice(1).map((v) => v.toFixed(2)).join(" / ")}（1号艇に対して。負なら市場の見込みより勝たない）・1レースの logloss ${base.logloss.toFixed(4)}`);
console.log("| 事情 | 係数 | 標準誤差 | 何倍 | logloss の改善 | 前半の係数 | 後半の係数 |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
for (const f of FACTORS) {
  const full = fit(groupsFor(f.value, everything), 7);
  const first = fit(groupsFor(f.value, (d) => d < SPLIT), 7), second = fit(groupsFor(f.value, (d) => d >= SPLIT), 7);
  console.log(`| ${f.label} | ${full.beta[6].toFixed(4)} | ${full.se[6].toFixed(4)} | ${(full.beta[6] / full.se[6]).toFixed(1)} | ${(base.logloss - full.logloss).toFixed(5)} | ${first.beta[6].toFixed(4)} | ${second.beta[6].toFixed(4)} |`);
}
// 市場の確率だけ（枠なし）との比較: 枠を足すとどれだけ良くなるか
const marketOnly = fit([...races.values()].filter((list) => list.length === 6 && list.filter((o) => o.win).length === 1).map((list) => list.map((o) => ({ x: [Math.log(o.p)], win: o.win }))), 1);
console.log(`参考: 市場の確率だけ（係数 ${marketOnly.beta[0].toFixed(3)}）の logloss ${marketOnly.logloss.toFixed(4)} → 枠を足すと ${base.logloss.toFixed(4)}（改善 ${(marketOnly.logloss - base.logloss).toFixed(4)}）`);

// ─── 「枠の得意度」だけ、見かけでないかを確かめる（事前登録の外） ───
const laneValue = FACTORS[0].value;
const complete = [...races.values()].filter((list) => list.length === 6 && list.filter((o) => o.win).length === 1);
const rowsOf = (list: Obs[], x: (o: Obs) => number[]) => list.map((o) => ({ x: x(o), win: o.win }));
const fitWith = (x: (o: Obs) => number[], k: number, filter: (date: string) => boolean = everything) => fit(complete.filter((list) => filter(list[0].date)).map((list) => rowsOf(list, x)), k);
const report = (label: string, r: { beta: number[]; se: number[] }, index: number) => console.log(`- ${label}: 係数 ${r.beta[index].toFixed(4)}（標準誤差 ${r.se[index].toFixed(4)}・${(r.beta[index] / r.se[index]).toFixed(1)} 倍）`);
console.log("\n「枠の得意度」の確かめ（事前登録の外）");
// (a) 市場の確率の曲がり（人気の艇ほど見込みより勝つ）を別に合わせても残るか
report("(a) 市場の確率の 2 乗の項も入れる", fitWith((o) => [...baseX(o), Math.log(o.p) ** 2, laneValue(o)], 8), 7);
// (b) ただの「強い選手」ではないか: 全国勝率（レースの中の差）と比べる
report("(b) 代わりに全国勝率（レースの中の差 1.0 あたり）", fitWith((o) => [...baseX(o), o.national], 7), 6);
const both = fitWith((o) => [...baseX(o), o.national, laneValue(o)], 8);
report("(b) 全国勝率と一緒に入れたときの 枠の得意度", both, 7);
report("(b) 全国勝率と一緒に入れたときの 全国勝率", both, 6);
// (c) 枠ごと
for (let lane = 1; lane <= 6; lane += 1) report(`(c) ${lane} 号艇だけに効かせる`, fitWith((o) => [...baseX(o), o.course === lane ? laneValue(o) : 0], 7), 6);
// (d) 前半で決めた式を、後半にそのまま当てる（後半のデータは式を決めるのに使わない）
{
  const firstHalf = (d: string) => d < SPLIT;
  const baseFirst = fitWith(baseX, 6, firstHalf), withFirst = fitWith((o) => [...baseX(o), laneValue(o)], 7, firstHalf);
  const logloss = (list: Obs[], beta: number[], x: (o: Obs) => number[]) => {
    const scores = list.map((o) => x(o).reduce((s, v, i) => s + v * beta[i], 0));
    const max = Math.max(...scores);
    return -(scores[list.findIndex((o) => o.win)] - max - Math.log(scores.reduce((s, v) => s + Math.exp(v - max), 0)));
  };
  const market = (list: Obs[]) => -Math.log(list.find((o) => o.win)!.p);
  for (const [label, filter] of [["後半全体", (d: string) => d >= SPLIT], ["9月", (d: string) => d.startsWith("2026-09")], ["10月", (d: string) => d.startsWith("2026-10")], ["11月", (d: string) => d.startsWith("2026-11")]] as Array<[string, (d: string) => boolean]>) {
    const test = complete.filter((list) => filter(list[0].date));
    const diffs = test.map((list) => logloss(list, baseFirst.beta, baseX) - logloss(list, withFirst.beta, (o) => [...baseX(o), laneValue(o)]));
    const vsMarket = test.map((list) => market(list) - logloss(list, withFirst.beta, (o) => [...baseX(o), laneValue(o)]));
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const se = (v: number[]) => sd(v) / Math.sqrt(v.length);
    console.log(`- (d) ${label} ${test.length} レース: 「市場+枠」→「市場+枠+枠の得意度」の logloss の改善 ${mean(diffs).toFixed(5)}（標準誤差 ${se(diffs).toFixed(5)}・${(mean(diffs) / se(diffs)).toFixed(1)} 倍）／市場の確率そのまま → 全部入り ${mean(vsMarket).toFixed(5)}（${(mean(vsMarket) / se(vsMarket)).toFixed(1)} 倍）`);
  }
  console.log(`  前半（${SPLIT} より前）で決めた係数: 市場 ${withFirst.beta[0].toFixed(3)}・枠 2〜6 ${withFirst.beta.slice(1, 6).map((v) => v.toFixed(2)).join(" / ")}・枠の得意度 ${withFirst.beta[6].toFixed(3)}`);
}

// (e) 場ごとの枠の強さ（イン が強い場など）の取りこぼしではないか
{
  report("(e) その場でのその枠の勝ちやすさ（過去の 1着率の対数。全国との差）を入れたときの 枠の得意度", fitWith((o) => [...baseX(o), o.venueLane, laneValue(o)], 8), 7);
  report("(e) そのときの 場の枠の勝ちやすさ", fitWith((o) => [...baseX(o), o.venueLane, laneValue(o)], 8), 6);
  const venues = [...new Set(observations.map((o) => o.venue))].sort();
  const venueX = (o: Obs) => venues.slice(1).map((v) => (o.course === 1 && o.venue === v ? 1 : 0));
  report(`(e) 場ごとの 1号艇の強さ（${venues.length} 場）を別々に合わせたときの 枠の得意度`, fitWith((o) => [...baseX(o), ...venueX(o), laneValue(o)], 6 + venues.length - 1 + 1), 6 + venues.length - 1);
}
// (f) 締切までの資金は、この事情の向きに動いているか（動いていれば、確定のオッズにはもう入っている）
{
  const rows = complete.map((list) => { const w = list.find((o) => o.win)!; return { drift: w.drift, value: laneValue(w), known: w.lane != null }; }).filter((r) => r.drift != null && r.known) as Array<{ drift: number; value: number }>;
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  const third = Math.floor(sorted.length / 3);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const parts = [["1着の艇の枠の得意度が低い 1/3", sorted.slice(0, third)], ["中くらい", sorted.slice(third, 2 * third)], ["高い 1/3", sorted.slice(2 * third)]] as Array<[string, typeof rows]>;
  console.log(`- (f) 当たった買い目の「確定の払戻 ÷ 締切5分前のオッズ」（${rows.length} レース。1 より小さいほど、締切までにその買い目へ資金が入った）`);
  for (const [label, part] of parts) console.log(`    ${label}: 幾何平均 ${Math.exp(mean(part.map((r) => r.drift))).toFixed(3)}（${part.length} レース・標準誤差 約 ${(sd(part.map((r) => r.drift)) / Math.sqrt(part.length)).toFixed(3)}）`);
  const mx = mean(rows.map((r) => r.value)), my = mean(rows.map((r) => r.drift));
  const sxx = rows.reduce((s, r) => s + (r.value - mx) ** 2, 0), sxy = rows.reduce((s, r) => s + (r.value - mx) * (r.drift - my), 0);
  const slope = sxy / sxx, resid = Math.sqrt(rows.reduce((s, r) => s + (r.drift - my - slope * (r.value - mx)) ** 2, 0) / (rows.length - 2));
  console.log(`    傾き（得意度 1 つ分あたりの対数の変化）: ${slope.toFixed(4)}（標準誤差 ${(resid / Math.sqrt(sxx)).toFixed(4)}）。比べる大きさ: 得意度 1 つ分は、1着の確率の対数で +${both.beta[7].toFixed(3)}`);
}

// (g) 直近 30 日の成績を使わない版でも残るか（成績の先取りが混ざっていれば、ここで消える）
{
  const lagSd = new Map<number, number>();
  for (let lane = 1; lane <= 6; lane += 1) lagSd.set(lane, sd(observations.filter((o) => o.course === lane && o.laneLag != null).map((o) => o.laneLag!)));
  report("(g) 30 日より前の成績だけで作った 枠の得意度", fitWith((o) => [...baseX(o), o.laneLag == null ? 0 : o.laneLag / lagSd.get(o.course)!], 7), 6);
}
// 次の確認（11/18 からの 4 週間）に、そのまま当てる式（ここで固定する）
{
  const frozen = fitWith((o) => [...baseX(o), laneValue(o)], 7);
  console.log(`\n固定する式（${FROM}〜${TO} の全部で合わせた）: 1着の点数 = ${frozen.beta[0].toFixed(4)} × log(市場の確率) + 枠 [0, ${frozen.beta.slice(1, 6).map((v) => v.toFixed(4)).join(", ")}] + ${frozen.beta[6].toFixed(4)} × 枠の得意度`);
  console.log(`枠の得意度 = (本人のその枠の 1着率 − 同じ級別のその枠の 1着率) ÷ 枠ごとの標準偏差 [${[1, 2, 3, 4, 5, 6].map((lane) => laneSd.get(lane)!.toFixed(4)).join(", ")}]（20 走未満は 0）`);
}
