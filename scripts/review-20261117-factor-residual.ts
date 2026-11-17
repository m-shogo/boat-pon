/**
 * 選手の事情（枠・場・相性・F 持ち・地元・節の重み）が、締切5分前の市場に織り込まれているかを測る。
 * 事前登録: docs/reviews/2026-11-17-factor-residual-screening.md。読み取りだけ・stdout のみ（用途: 監査・精度）。
 *
 * 物差し: 事情を持つ艇の「実際の 1着の数 ÷ 市場が見込んだ 1着の数」。1 なら織り込み済み。
 *
 * 実行（本番の作業コピーで）: npx tsx scripts/review-20261117-factor-residual.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--split YYYY-MM-DD]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
type ProgramBoat = { course: number; registrationNo?: string; className?: string; nationalWinRate?: number; localWinRate?: number; motorNo?: string };
type EvalRace = { raceId: string; date: string; venue: string; closeAt: string; marketWin: number[]; winner: number; boats: ProgramBoat[]; drift: number | null; tri: Map<string, number>; combo: string; odds: Map<string, number>; payoutYen: number | null };
const { t5, t10, t20 } = loadCompleteCaptures(db, FROM, TO);
const champion = loadChampionCalibration();
log(`締切5分前の完全な市場 ${t5.size} レース`);
const programs = new Map<string, { date: string; venue: string; closeAt: string; boats: ProgramBoat[] }>();
const classByStart = new Map<string, string>(); // `${raceId}|${枠}` → 級別（枠の基準を作るため。2024-01〜）
for (const r of db.prepare("SELECT race_id, date, venue, close_at, raw_json FROM official_programs WHERE date >= ? AND date <= ?").iterate(LANE_FROM, TO) as Iterable<{ race_id: string; date: string; venue: string; close_at: string; raw_json: string }>) {
  let boats: ProgramBoat[] = [];
  try { boats = (JSON.parse(r.raw_json) as { boats?: ProgramBoat[] }).boats ?? []; } catch { continue; }
  for (const b of boats) if (b.className) classByStart.set(`${r.race_id}|${b.course}`, b.className);
  if (r.date >= FROM) programs.set(r.race_id, { date: r.date, venue: r.venue, closeAt: r.close_at, boats });
}
log(`番組表 ${programs.size} レース（評価の期間）・級別 ${classByStart.size} 走`);
const evalRaces = new Map<string, EvalRace>();
for (const r of db.prepare("SELECT race_id, trifecta, payout_yen FROM race_results WHERE date >= ? AND date <= ? AND trifecta IS NOT NULL").all(FROM, TO) as Array<{ race_id: string; trifecta: string; payout_yen: number | null }>) {
  const odds = t5.get(r.race_id);
  const program = programs.get(r.race_id);
  if (!odds || !program || !/^[1-6]-[1-6]-[1-6]$/.test(r.trifecta)) continue;
  if (program.boats.length !== 6 || new Set(program.boats.map((b) => b.course)).size !== 6) continue;
  const p = calibratedMarketProbabilities(odds, t10.get(r.race_id) ?? t20.get(r.race_id) ?? null, champion);
  if (!p || p.size !== 120 || !p.has(r.trifecta)) continue;
  const marketWin = [0, 0, 0, 0, 0, 0];
  for (const [selection, prob] of p) marketWin[Number(selection[0]) - 1] += prob;
  if (marketWin.some((v) => !(v > 0))) continue;
  // 当たった買い目の、確定の払戻 ÷ 締切5分前のオッズ（対数）。締切までの資金の動きを見るため
  const o5 = odds.get(r.trifecta);
  const drift = o5 != null && o5 > 0 && r.payout_yen != null && r.payout_yen > 0 ? Math.log(r.payout_yen / 100 / o5) : null;
  evalRaces.set(r.race_id, { raceId: r.race_id, date: program.date, venue: program.venue, closeAt: program.closeAt, marketWin, winner: Number(r.trifecta[0]), boats: [...program.boats].sort((a, b) => a.course - b.course), drift, tri: p, combo: r.trifecta, odds, payoutYen: r.payout_yen });
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
const ageWeightByRacerDay = new Map<string, [number, number]>(); // `${date}|${登番}` → [年齢, 体重]
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
        ageWeightByRacerDay.set(`${date}|${m[2]}`, [Number(m[4]), Number(m[6])]);
      }
      files += 1;
    } catch { /* 読めない日は、支部・節の名前なしで数える */ } finally { try { rmSync(txtPath); } catch { /* */ } }
  }
  rmSync(tmp, { recursive: true, force: true });
  log(`B ファイル ${files} 日分（支部 ${branchByRacerDay.size} 走）`);
}

// ─── 公式のレーサー期別成績（ファン手帳のデータ。data/raw/official/fan/fanYYMM.lzh。2026-11-17 に取得） ───
// 期の成績は、その期が終わった後のレースにだけ使う。評価の期間より前に終わった期だけを足す。
type FanRacer = { birthMonthDay: string; female: boolean; term: number; entries: number[]; wins: number[] };
const fanByReg = new Map<string, FanRacer>();
const fanClassCourse = new Map<string, number[]>(); // `${級別}|${コース}` → [進入, 1着]
{
  const dir = path.join("data", "raw", "official", "fan");
  const tmp = mkdtempSync(path.join(tmpdir(), "boatpon-fan-"));
  let periods = 0;
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => /^fan\d{4}\.lzh$/.test(f)).sort() : []) {
    const out = path.join(tmp, file.replace(".lzh", ""));
    try {
      execFileSync("unar", ["-q", "-o", out, "-f", path.join(dir, file)]);
      const bytes = readFileSync(path.join(out, readdirSync(out)[0]));
      const ascii = (record: Buffer, from: number, length: number) => record.subarray(from, from + length).toString("latin1");
      let used = false;
      for (let offset = 0; offset + 416 <= bytes.length; offset += 418) {
        const record = bytes.subarray(offset, offset + 416);
        const reg = ascii(record, 0, 4);
        if (!/^\d{4}$/.test(reg)) continue;
        const end = ascii(record, 187, 8);
        const periodEnd = `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`;
        const racer = fanByReg.get(reg) ?? { birthMonthDay: "", female: false, term: 0, entries: [0, 0, 0, 0, 0, 0], wins: [0, 0, 0, 0, 0, 0] };
        racer.birthMonthDay = `${ascii(record, 44, 2)}-${ascii(record, 46, 2)}`;
        racer.female = ascii(record, 48, 1) === "2";
        racer.term = Number(ascii(record, 195, 3));
        if (periodEnd < FROM) {
          used = true;
          const cls = ascii(record, 39, 2);
          for (let c = 0; c < 6; c += 1) {
            const entries = Number(ascii(record, 82 + 13 * c, 3)), wins = Number(ascii(record, 198 + 34 * c, 3));
            racer.entries[c] += entries; racer.wins[c] += wins;
            const base = fanClassCourse.get(`${cls}|${c + 1}`) ?? [0, 0]; base[0] += entries; base[1] += wins; fanClassCourse.set(`${cls}|${c + 1}`, base);
          }
        }
        fanByReg.set(reg, racer);
      }
      if (used) periods += 1;
    } catch (error) { log(`期別成績 ${file} を読めない: ${(error as Error).message}`); }
  }
  rmSync(tmp, { recursive: true, force: true });
  log(`期別成績 ${fanByReg.size} 人（コース別の成績は ${periods} 期分）`);
}

// ─── 展示タイム（直前情報）。締切5分前までに 6艇とも手元にあったレースだけ使う ───
const exhibitionAtT5 = new Map<string, Map<number, number>>();
{
  const times = new Map<string, Map<number, number>>(), fetched = new Map<string, number>();
  for (const r of db.prepare("SELECT race_id, course, exhibition_time, fetched_at FROM exhibition_data WHERE race_id >= ? AND race_id < ? AND exhibition_time > 0")
    .iterate(FROM.replaceAll("-", ""), `${TO.replaceAll("-", "")}~`) as Iterable<{ race_id: string; course: number; exhibition_time: number; fetched_at: string }>) {
    const m = times.get(r.race_id) ?? new Map<number, number>(); m.set(r.course, r.exhibition_time); times.set(r.race_id, m);
    const at = Date.parse(r.fetched_at.includes("T") ? r.fetched_at : `${r.fetched_at.replace(" ", "T")}Z`);
    if (Number.isFinite(at)) fetched.set(r.race_id, Math.max(fetched.get(r.race_id) ?? 0, at));
  }
  for (const [raceId, m] of times) {
    const race = evalRaces.get(raceId), at = fetched.get(raceId);
    if (!race || m.size !== 6 || at == null) continue;
    const close = Date.parse(`${race.date}T${race.closeAt}:00+09:00`);
    if (Number.isFinite(close) && at <= close - 5 * 60_000) exhibitionAtT5.set(raceId, m);
  }
  log(`締切5分前までに展示が 6艇そろっていたレース ${exhibitionAtT5.size}`);
}

// ─── レースの種類 ───
const raceTypeById = new Map((db.prepare("SELECT race_id, race_type FROM race_conditions WHERE date >= ? AND date <= ?").all(FROM, TO) as Array<{ race_id: string; race_type: string | null }>).map((r) => [r.race_id, r.race_type ?? ""]));
const raceGroup = (type: string) => /準優/.test(type) ? "準優勝戦" : /優勝戦/.test(type) ? "優勝戦" : /予選/.test(type) ? "予選" : /選抜|特選|特賞|ドリーム/.test(type) ? "選抜・特選など" : /一般/.test(type) ? "一般" : "そのほか";

// ─── 過去の成績を日付の順にたどり、その日より前の記録だけで事情を作る ───
type Entry = { race_id: string; date: string; boat: number; finish_pos: number | null; status_code: string | null; racer_reg: string | null; motor_no: number | null; exhibition_time: number | null; st: number | null; st_flying: number | null };
const history = db.prepare("SELECT race_id, date, boat, finish_pos, status_code, racer_reg, motor_no, exhibition_time, st, st_flying FROM race_entries WHERE date >= ? AND date <= ? ORDER BY date, race_id").all(H2H_FROM, TO) as Entry[];
log(`過去の成績 ${history.length} 走（${H2H_FROM}〜）`);
// 通算の 1着の数（手元の K ファイルの範囲）。2005年以降に初めて走った選手だけ、通算として使う
const careerWins = new Map<string, number>(), firstStart = new Map<string, string>();
for (const r of db.prepare("SELECT racer_reg, MIN(date) first, SUM(finish_pos = 1) wins FROM race_entries WHERE date < ? AND racer_reg IS NOT NULL GROUP BY racer_reg").all(H2H_FROM) as Array<{ racer_reg: string; first: string; wins: number | null }>) {
  careerWins.set(r.racer_reg, r.wins ?? 0); firstStart.set(r.racer_reg, r.first);
}
log(`通算の 1着（${H2H_FROM} より前）${careerWins.size} 人`);
const racerLane = new Map<string, number[]>(); // `${登番}|${枠}` → [走, 1着]
const classLane = new Map<string, number[]>(); // `${級別}|${枠}` → [走, 1着]
const racerLaneLag = new Map<string, number[]>(), classLaneLag = new Map<string, number[]>(); // 30 日より前の成績だけで作る版（先取りが混ざっていないかの確認用）
const lagQueue: Entry[][] = [];
// 育成枠の第 2 回の材料（docs/reviews/2026-11-17-second-prediction-track.md）
const POINTS = [0, 10, 8, 6, 4, 2, 1];
const points = (finish: number | null) => (finish != null && finish >= 1 && finish <= 6 ? POINTS[finish] : 0);
const classLanePts = new Map<string, number[]>(); // `${級別}|${枠}` → [走, 点数の合計]
const racerForm = new Map<string, Array<[string, number, string]>>(); // 登番 → [日付, 調子（点数 − 級別と枠の平均）, 場]
const motorForm = new Map<string, Array<[string, number]>>(); // `${場}|${モーター}` → [日付, 調子]
const racerLaneSt = new Map<string, number[]>(), laneSt = new Map<string, number[]>(); // [走, ST の合計]
const racerEx = new Map<string, number[]>(); // 登番 → [走, 展示タイムのレース内の差の合計]
const lastStart = new Map<string, string>(); // 登番 → 最後に走った日
const lane2Let = new Map<string, number[]>(); // 2号艇の選手の登番 → [走, 1号艇が勝った]
const lane2All = [0, 0];
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const venueLane = new Map<string, number[]>(); // `${場}|${枠}` → [走, 1着]（その場でその枠がどれだけ勝つか）
const allLane = new Map<string, number[]>(); // 枠 → [走, 1着]
const pair = new Map<string, number[]>(); // `${a}|${b}`（a < b）→ [a が先着, b が先着]
const fDates = new Map<string, string[]>(); // 登番 → F の日付
const bump = (map: Map<string, number[]>, key: string, i: number) => { const v = map.get(key) ?? [0, 0]; v[i] += 1; map.set(key, v); };
const periodStart = (date: string) => { const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))]; return m >= 11 ? `${y}-11-01` : m >= 5 ? `${y}-05-01` : `${y - 1}-11-01`; };

type Obs = { date: string; p: number; win: 0 | 1; tags: string[]; lane?: number; h2h?: number; raceId: string; course: number; venueDiff?: number; fCount: number; local: boolean; branchKnown: boolean; national: number; venue: string; venueLane: number; drift: number | null; laneLag?: number; f: Record<string, number | undefined> };
const observations: Obs[] = [];
function evaluate(race: EvalRace) {
  const type = raceGroup(raceTypeById.get(race.raceId) ?? "");
  const favorite = race.marketWin.indexOf(Math.max(...race.marketWin));
  const regs = race.boats.map((b) => b.registrationNo ?? "");
  const title = titleByRacerDay.get(`${race.date}|${regs[0]}`) ?? "";
  const anniversary = /周年/.test(title);
  const since90 = addDays(race.date, -90), since7 = addDays(race.date, -7), since120 = addDays(race.date, -120);
  race.boats.forEach((boat, i) => {
    const reg = regs[i];
    const tags: string[] = [];
    const obs: Obs = { f: {}, date: race.date, p: race.marketWin[i], win: race.winner === boat.course ? 1 : 0, tags, raceId: race.raceId, course: boat.course, fCount: 0, local: false, branchKnown: false, venue: race.venue, drift: race.drift, venueLane: (() => { const v = venueLane.get(`${race.venue}|${boat.course}`), g = allLane.get(String(boat.course)); return v && g && v[0] >= 300 && v[1] > 0 && g[1] > 0 ? Math.log(v[1] / v[0]) - Math.log(g[1] / g[0]) : 0; })(), national: (boat.nationalWinRate ?? 0) - race.boats.reduce((sum, b) => sum + (b.nationalWinRate ?? 0), 0) / 6 };
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
    // ── 育成枠の第 2 回の材料 ──
    if (reg) {
      const form = racerForm.get(reg) ?? [];
      const recent = form.filter(([d]) => d >= since90);
      if (recent.length >= 10) obs.f["6 直近 90 日の調子"] = recent.reduce((sum, [, v]) => sum + v, 0) / recent.length;
      const series = form.filter(([d, , venue]) => d >= since7 && venue === race.venue);
      if (series.length >= 2) obs.f["7 今節の調子"] = series.reduce((sum, [, v]) => sum + v, 0) / series.length;
      const st = racerLaneSt.get(`${reg}|${boat.course}`), stAll = laneSt.get(String(boat.course));
      if (st && st[0] >= 20 && stAll && stAll[0] > 0) obs.f["9 その枠での平均スタート（速いほど正）"] = stAll[1] / stAll[0] - st[1] / st[0];
      const last = lastStart.get(reg);
      obs.f["12 休み明け（30 日以上）"] = last != null && dayDiff(last, race.date) >= 30 ? 1 : 0;
    }
    const motor = motorForm.get(`${race.venue}|${Number(boat.motorNo)}`)?.filter(([d]) => d >= since120);
    if (motor && motor.length >= 12) obs.f["8 モーターの素性"] = motor.reduce((sum, [, v]) => sum + v, 0) / motor.length;
    const exhibition = exhibitionAtT5.get(race.raceId);
    if (exhibition) {
      const mean = [...exhibition.values()].reduce((a, b) => a + b, 0) / 6;
      const raw = -(exhibition.get(boat.course)! - mean) * 10;
      obs.f["10 展示タイム（速いほど正）"] = raw;
      const usual = racerEx.get(reg);
      obs.f["11 展示タイムの本人比"] = usual && usual[0] >= 20 ? raw - -(usual[1] / usual[0]) * 10 : raw;
    }
    const ageWeight = regs.map((r) => ageWeightByRacerDay.get(`${race.date}|${r}`));
    if (ageWeight.every((v) => v != null)) {
      obs.f["13 体重（重いほど正・kg）"] = ageWeight[i]![1] - ageWeight.reduce((sum, v) => sum + v![1], 0) / 6;
      obs.f["14 年齢（10 歳あたり）"] = (ageWeight[i]![0] - ageWeight.reduce((sum, v) => sum + v![0], 0) / 6) / 10;
    }
    if (boat.course === 1 && regs[1]) {
      const let2 = lane2Let.get(regs[1]);
      if (let2 && let2[0] >= 20 && lane2All[0] > 0) obs.f["15 2号艇の選手の逃がし率（1号艇に付ける）"] = let2[1] / let2[0] - lane2All[1] / lane2All[0];
    }
    // ── 育成枠の第 3 回の材料（期別成績ファイル・通算の 1着） ──
    const fan = fanByReg.get(reg);
    if (fan) {
      const year = Number(race.date.slice(0, 4));
      const gap = Math.min(...[year - 1, year, year + 1].map((y) => Math.abs(dayDiff(`${y}-${fan.birthMonthDay}`, race.date))).filter((d) => Number.isFinite(d)));
      obs.f["24 誕生日の前後 3 日"] = gap <= 3 ? 1 : 0;
      const fans = regs.map((r) => fanByReg.get(r));
      if (fans.every((v) => v != null)) {
        const mixed = fans.some((v) => v!.female) && fans.some((v) => !v!.female);
        obs.f["27 男女混合のレースの女子"] = mixed && fan.female ? 1 : 0;
        obs.f["28 養成期（10 期あたり・新しいほど正）"] = (fan.term - fans.reduce((sum, v) => sum + v!.term, 0) / 6) / 10;
      }
      const base = fanClassCourse.get(`${boat.className}|${boat.course}`);
      if (fan.entries[boat.course - 1] >= 20 && base && base[0] >= 200) obs.f["29 公式の進入コース別の 1着率"] = fan.wins[boat.course - 1] / fan.entries[boat.course - 1] - base[1] / base[0];
    }
    const first = firstStart.get(reg);
    if (reg && first != null && first >= "2005-01-01") {
      const remainder = (careerWins.get(reg) ?? 0) % 100;
      obs.f["26 次の 1着が 100 勝ごとの節目"] = remainder === 99 ? 1 : 0;
      obs.f["26.5 節目まであと 3 勝以内"] = remainder >= 97 ? 1 : 0;
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
  // 育成枠の第 2 回の材料
  const exValid = entries.filter((e) => e.exhibition_time != null && e.exhibition_time > 0);
  const exMean = exValid.length === 6 ? exValid.reduce((sum, e) => sum + e.exhibition_time!, 0) / 6 : null;
  const lane1 = entries.find((e) => e.boat === 1), lane2 = entries.find((e) => e.boat === 2);
  if (date >= LANE_FROM && lane1 && lane2?.racer_reg) {
    bump(lane2Let, lane2.racer_reg, 0); lane2All[0] += 1;
    if (lane1.finish_pos === 1) { bump(lane2Let, lane2.racer_reg, 1); lane2All[1] += 1; }
  }
  for (const e of entries) {
    if (!e.racer_reg) continue;
    const cls = classByStart.get(`${e.race_id}|${e.boat}`);
    const pts = points(e.finish_pos);
    if (cls && date >= LANE_FROM) {
      const base = classLanePts.get(`${cls}|${e.boat}`);
      if (base && base[0] >= 200) {
        const excess = pts - base[1] / base[0];
        const list = racerForm.get(e.racer_reg) ?? []; list.push([date, excess, e.race_id.split("-")[1]]); racerForm.set(e.racer_reg, list);
        if (e.motor_no != null) { const key = `${e.race_id.split("-")[1]}|${e.motor_no}`; const m = motorForm.get(key) ?? []; m.push([date, excess]); motorForm.set(key, m); }
      }
      const v = classLanePts.get(`${cls}|${e.boat}`) ?? [0, 0]; v[0] += 1; v[1] += pts; classLanePts.set(`${cls}|${e.boat}`, v);
    }
    if (date >= LANE_FROM && e.st != null && !e.st_flying) {
      const a = racerLaneSt.get(`${e.racer_reg}|${e.boat}`) ?? [0, 0]; a[0] += 1; a[1] += e.st; racerLaneSt.set(`${e.racer_reg}|${e.boat}`, a);
      const b = laneSt.get(String(e.boat)) ?? [0, 0]; b[0] += 1; b[1] += e.st; laneSt.set(String(e.boat), b);
    }
    if (date >= LANE_FROM && exMean != null) { const a = racerEx.get(e.racer_reg) ?? [0, 0]; a[0] += 1; a[1] += e.exhibition_time! - exMean; racerEx.set(e.racer_reg, a); }
    lastStart.set(e.racer_reg, date);
    if (!firstStart.has(e.racer_reg)) firstStart.set(e.racer_reg, date);
    if (e.finish_pos === 1) careerWins.set(e.racer_reg, (careerWins.get(e.racer_reg) ?? 0) + 1);
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

// ─── 育成枠の第 2 回のふるい（事前登録: docs/reviews/2026-11-17-second-prediction-track.md） ───
{
  const firstHalf = (d: string) => d < SPLIT, secondHalf = (d: string) => d >= SPLIT;
  const names = [...new Set(observations.flatMap((o) => Object.keys(o.f)))].sort((a, b) => Number(a.split(" ")[0]) - Number(b.split(" ")[0]));
  const V1 = ["8 モーターの素性", "10 展示タイム（速いほど正）", "11 展示タイムの本人比", "14 年齢（10 歳あたり）"]; // 第 2 回で残った材料（第 1 版）。第 3 回の結果では入れ替えない
  // 大きさをそろえる: 前半の、値がある艇の標準偏差で割る（1 か 0 の材料はそのまま）。値が無い艇は 0（レースの平均と同じ扱い）
  const scale = new Map(names.map((name) => {
    const values = observations.filter((o) => firstHalf(o.date) && o.f[name] != null).map((o) => o.f[name]!);
    return [name, values.every((v) => v === 0 || v === 1) ? 1 : sd(values)];
  }));
  const value = (name: string) => (o: Obs) => (o.f[name] == null ? 0 : o.f[name]! / scale.get(name)!);
  const base2 = (o: Obs) => [...baseX(o), laneValue(o)];
  const loglossOf = (list: Obs[], beta: number[], x: (o: Obs) => number[]) => {
    const scores = list.map((o) => x(o).reduce((sum, v, i) => sum + v * beta[i], 0));
    const max = Math.max(...scores);
    return -(scores[list.findIndex((o) => o.win)] - max - Math.log(scores.reduce((sum, v) => sum + Math.exp(v - max), 0)));
  };
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const test = complete.filter((list) => secondHalf(list[0].date));
  const baseFirst = fitWith(base2, 7, firstHalf);
  console.log(`\n育成枠・第 2 回のふるい: 土台は「市場 + 枠 + 枠の得意度」。前半 ${complete.length - test.length} レースで係数を見て、後半 ${test.length} レースに当てる`);
  console.log("| 材料 | 値がある艇 | 前半の係数 | 標準誤差 | 何倍 | 後半の logloss の改善 | 標準誤差 | 何倍 | 判定 |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  const passed: string[] = [];
  const passedNew: string[] = [];
  for (const name of names) {
    const x = (o: Obs) => [...base2(o), value(name)(o)];
    const first = fitWith(x, 8, firstHalf);
    const z = first.beta[7] / first.se[7];
    const diffs = test.map((list) => loglossOf(list, baseFirst.beta, base2) - loglossOf(list, first.beta, x));
    const gain = mean(diffs), gainSe = sd(diffs) / Math.sqrt(diffs.length);
    const candidate = Math.abs(z) >= 3, ok = candidate && gain / gainSe >= 2;
    if (ok && V1.includes(name)) passed.push(name);
    if (ok && !V1.includes(name)) passedNew.push(name);
    console.log(`| ${name} | ${observations.filter((o) => o.f[name] != null).length} | ${first.beta[7].toFixed(4)} | ${first.se[7].toFixed(4)} | ${z.toFixed(1)} | ${gain.toFixed(5)} | ${gainSe.toFixed(5)} | ${(gain / gainSe).toFixed(1)} | ${ok ? "**兆しあり**" : candidate ? "候補だが後半で残らない" : "閉じる"} |`);
  }
  // 兆しありの材料を全部入れた式（前半で決める）を、後半で「市場の確率そのまま」と比べる
  const xAll = (o: Obs) => [...base2(o), ...passed.map((name) => value(name)(o))];
  const all = fitWith(xAll, 7 + passed.length, firstHalf);
  const market = (list: Obs[]) => -Math.log(list.find((o) => o.win)!.p);
  const line = (label: string, filter: (d: string) => boolean) => {
    const part = test.filter((list) => filter(list[0].date));
    const vsMarket = part.map((list) => market(list) - loglossOf(list, all.beta, xAll));
    const vsBase = part.map((list) => loglossOf(list, baseFirst.beta, base2) - loglossOf(list, all.beta, xAll));
    console.log(`- ${label} ${part.length} レース: 市場そのまま ${mean(part.map(market)).toFixed(4)} → 全部入り ${mean(part.map((list) => loglossOf(list, all.beta, xAll))).toFixed(4)}（改善 ${mean(vsMarket).toFixed(5)}・標準誤差 ${(sd(vsMarket) / Math.sqrt(part.length)).toFixed(5)}・説明力 ΔR² ${(mean(vsMarket) / Math.log(6)).toFixed(4)}）／土台からの改善 ${mean(vsBase).toFixed(5)}（${(mean(vsBase) / (sd(vsBase) / Math.sqrt(part.length))).toFixed(1)} 倍）`);
  };
  console.log(`\n第 3 回 B: 新しい材料（24〜29）で兆しあり: ${passedNew.join("・") || "なし"}`);
  console.log(`\n兆しありの材料（${passed.length} 個）を全部入れた式を前半で決め、後半に当てる: ${passed.join("・") || "なし"}`);
  line("後半全体", secondHalf); line("9月", (d) => d.startsWith("2026-09")); line("10月", (d) => d.startsWith("2026-10")); line("11月", (d) => d.startsWith("2026-11"));
  console.log(`  前半で決めた係数: 市場 ${all.beta[0].toFixed(3)}・枠 2〜6 ${all.beta.slice(1, 6).map((v) => v.toFixed(2)).join(" / ")}・枠の得意度 ${all.beta[6].toFixed(3)}${passed.map((name, i) => `・${name.split("（")[0]} ${all.beta[7 + i].toFixed(3)}（1 つ分 = ${scale.get(name)!.toFixed(4)}）`).join("")}`);
}

// ─── 育成枠の第 3 回（事前登録: docs/reviews/2026-11-17-second-prediction-track.md） ───
{
  const firstHalf = (d: string) => d < SPLIT;
  const V1 = ["8 モーターの素性", "10 展示タイム（速いほど正）", "11 展示タイムの本人比", "14 年齢（10 歳あたり）"];
  const scaleOf = (name: string) => { const values = observations.filter((o) => firstHalf(o.date) && o.f[name] != null).map((o) => o.f[name]!); return values.every((v) => v === 0 || v === 1) ? 1 : sd(values); };
  const scales = new Map([...V1, "28 養成期（10 期あたり・新しいほど正）"].map((name) => [name, scaleOf(name)]));
  const scaled = (o: Obs, name: string) => (o.f[name] == null ? 0 : o.f[name]! / scales.get(name)!);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const se = (v: number[]) => sd(v) / Math.sqrt(v.length);

  // B の補足: 年齢と養成期を一緒に入れる（年齢の効き目は、年齢か経験か）
  const ageTerm = fitWith((o) => [...baseX(o), laneValue(o), scaled(o, "14 年齢（10 歳あたり）"), scaled(o, "28 養成期（10 期あたり・新しいほど正）")], 9, firstHalf);
  console.log(`\n第 3 回 B の補足（前半）: 年齢と養成期を一緒に入れる → 年齢 ${ageTerm.beta[7].toFixed(4)}（${(ageTerm.beta[7] / ageTerm.se[7]).toFixed(1)} 倍）・養成期 ${ageTerm.beta[8].toFixed(4)}（${(ageTerm.beta[8] / ageTerm.se[8]).toFixed(1)} 倍）`);

  // A. 3連単へ広げる: 点数 = γ × log(市場の 3連単の確率) + 1着・2着・3着の艇の材料（着順ごとに別の係数）
  const boatX = (o: Obs) => [...[2, 3, 4, 5, 6].map((lane) => (o.course === lane ? 1 : 0)), laneValue(o), ...V1.map((name) => scaled(o, name))]; // 10 個
  const G = 10;
  type TriRace = { date: string; logq: Float64Array; x: Float64Array[]; winner: number; odds: Float64Array; payoutYen: number | null }; // x[c] は 1 + 3G 個
  const triRaces: TriRace[] = [];
  for (const list of complete) {
    const race = evalRaces.get(list[0].raceId)!;
    const byCourse = new Map(list.map((o) => [o.course, boatX(o)]));
    const combos = [...race.tri.keys()];
    const x = combos.map((combo) => {
      const row = new Float64Array(1 + 3 * G);
      row[0] = Math.log(race.tri.get(combo)!);
      combo.split("-").forEach((boat, position) => byCourse.get(Number(boat))!.forEach((v, i) => { row[1 + position * G + i] = v; }));
      return row;
    });
    triRaces.push({ date: race.date, logq: Float64Array.from(combos, (combo) => Math.log(race.tri.get(combo)!)), x, winner: combos.indexOf(race.combo), odds: Float64Array.from(combos, (combo) => race.odds.get(combo) ?? NaN), payoutYen: race.payoutYen });
  }
  const fitTri = (k: number) => fit(triRaces.filter((r) => firstHalf(r.date)).map((r) => r.x.map((row, c) => ({ x: Array.from(row.subarray(0, k)), win: (c === r.winner ? 1 : 0) as 0 | 1 }))), k);
  const lossTri = (r: TriRace, beta: number[]) => {
    let max = -Infinity; const scores = r.x.map((row) => { let v = 0; for (let i = 0; i < beta.length; i += 1) v += row[i] * beta[i]; if (v > max) max = v; return v; });
    return -(scores[r.winner] - max - Math.log(scores.reduce((sum, v) => sum + Math.exp(v - max), 0)));
  };
  const topTri = (r: TriRace, beta: number[] | null) => { let best = 0, bestScore = -Infinity; r.x.forEach((row, c) => { let v = 0; if (beta) for (let i = 0; i < beta.length; i += 1) v += row[i] * beta[i]; else v = row[0]; if (v > bestScore) { bestScore = v; best = c; } }); return best; };
  const models = [1, 1 + G, 1 + 2 * G, 1 + 3 * G].map((k, i) => { const r = fitTri(k); log(`3連単 M${i} を前半で合わせた（係数 ${k} 個）`); return r; });
  const test = triRaces.filter((r) => !firstHalf(r.date));
  const market = (r: TriRace) => -r.logq[r.winner];
  console.log(`\n第 3 回 A: 3連単へ広げる。前半 ${triRaces.length - test.length} レースで式を決め、後半 ${test.length} レースに当てる（3連単の logloss。小さいほど良い）`);
  console.log(`- 市場の確率そのまま ${mean(test.map(market)).toFixed(4)} / M0（市場だけ・γ=${models[0].beta[0].toFixed(3)}）${mean(test.map((r) => lossTri(r, models[0].beta))).toFixed(4)} / M1（＋1着）${mean(test.map((r) => lossTri(r, models[1].beta))).toFixed(4)} / M2（＋2着）${mean(test.map((r) => lossTri(r, models[2].beta))).toFixed(4)} / M3（＋3着）${mean(test.map((r) => lossTri(r, models[3].beta))).toFixed(4)}`);
  const step = (label: string, from: (r: TriRace) => number, to: (r: TriRace) => number, rows = test) => { const d = rows.map((r) => from(r) - to(r)); console.log(`- ${label}: 改善 ${mean(d).toFixed(5)}（標準誤差 ${se(d).toFixed(5)}・${(mean(d) / se(d)).toFixed(1)} 倍・${rows.length} レース）`); };
  step("市場そのまま → M3", market, (r) => lossTri(r, models[3].beta));
  step("M0 → M1（1着の艇の材料）", (r) => lossTri(r, models[0].beta), (r) => lossTri(r, models[1].beta));
  step("M1 → M2（2着の艇の材料）", (r) => lossTri(r, models[1].beta), (r) => lossTri(r, models[2].beta));
  step("M2 → M3（3着の艇の材料）", (r) => lossTri(r, models[2].beta), (r) => lossTri(r, models[3].beta));
  for (const month of ["2026-09", "2026-10", "2026-11"]) step(`市場そのまま → M3（${month}）`, market, (r) => lossTri(r, models[3].beta), test.filter((r) => r.date.startsWith(month)));
  const hits = (beta: number[] | null) => test.filter((r) => topTri(r, beta) === r.winner).length;
  console.log(`- いちばん確率が高い 1 点が当たった数（後半 ${test.length} レース）: 市場 ${hits(null)}（${((hits(null) / test.length) * 100).toFixed(2)}%）/ M3 ${hits(models[3].beta)}（${((hits(models[3].beta) / test.length) * 100).toFixed(2)}%）・1 点が同じレース ${test.filter((r) => topTri(r, null) === topTri(r, models[3].beta)).length}`);
  const names = ["枠2", "枠3", "枠4", "枠5", "枠6", "枠の得意度", "モーター", "展示", "展示の本人比", "年齢"];
  for (let position = 0; position < 3; position += 1) console.log(`  M3 の ${position + 1}着の係数（標準誤差の何倍）: ${names.map((n, i) => `${n} ${models[3].beta[1 + position * G + i].toFixed(3)}（${(models[3].beta[1 + position * G + i] / models[3].se[1 + position * G + i]).toFixed(1)}）`).join("・")}`);
  console.log(`  γ（市場の確率の対数の係数）: ${models[3].beta[0].toFixed(3)}`);

  // C. 回収率の試算（買い方は数える前に固定: M2 の確率 × 締切5分前のオッズ ≥ 1.20 かつ 確率 ≥ 3%。公式の確定払戻）
  const probsOf = (r: TriRace, beta: number[] | null): number[] => {
    if (!beta) return Array.from(r.logq, (v) => Math.exp(v));
    let max = -Infinity; const scores = r.x.map((row) => { let v = 0; for (let i = 0; i < beta.length; i += 1) v += row[i] * beta[i]; if (v > max) max = v; return v; });
    const e = scores.map((v) => Math.exp(v - max)), sum = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / sum);
  };
  const backtest = (rows: TriRace[], beta: number[] | null, evMin: number, pMin: number) => {
    let picks = 0, hits = 0, stake = 0, payout = 0; const perRace: Array<[number, number]> = [];
    for (const r of rows) {
      const p = probsOf(r, beta); let s = 0, ret = 0;
      for (let c = 0; c < p.length; c += 1) {
        if (!(p[c] >= pMin) || !(r.odds[c] > 0) || !(p[c] * r.odds[c] >= evMin)) continue;
        picks += 1; s += 100;
        if (c === r.winner && r.payoutYen != null) { hits += 1; ret += r.payoutYen; }
      }
      if (s > 0) { perRace.push([s, ret]); stake += s; payout += ret; }
    }
    const roi = stake ? payout / stake : NaN;
    const seRoi = stake ? Math.sqrt(perRace.reduce((sum, [s, ret]) => sum + (ret - roi * s) ** 2, 0)) / stake : NaN;
    return { picks, hits, races: perRace.length, roi, seRoi };
  };
  const pctOf = (v: number) => `${(v * 100).toFixed(1)}%`;
  const show = (label: string, b: ReturnType<typeof backtest>) => console.log(`- ${label}: 買い目 ${b.picks}（${b.races} レース）・的中 ${b.hits}（${b.picks ? pctOf(b.hits / b.picks) : "-"}）・回収率 ${pctOf(b.roi)}（標準誤差 ${pctOf(b.seRoi)}）`);
  const m2 = models[2].beta;
  console.log(`\n第 3 回 C: 回収率の試算（式は前半で決めた M2。後半 ${test.length} レース・公式の確定払戻・1 点 100 円）`);
  show("**主の決まり**（期待値 1.20 以上・確率 3% 以上）", backtest(test, m2, 1.2, 0.03));
  for (const month of ["2026-09", "2026-10", "2026-11"]) show(`  ${month}`, backtest(test.filter((r) => r.date.startsWith(month)), m2, 1.2, 0.03));
  show("同じ決まりを「市場の確率そのまま」に当てる", backtest(test, null, 1.2, 0.03));
  console.log("参考（判定には使わない）: 期待値の線 × 確率の下限");
  console.log("| 期待値の線 | 確率 1% 以上 | 確率 3% 以上 | 確率 5% 以上 |");
  console.log("|---|---|---|---|");
  for (const ev of [1.0, 1.1, 1.2, 1.3]) console.log(`| ${ev.toFixed(2)} 以上 | ${[0.01, 0.03, 0.05].map((pm) => { const b = backtest(test, m2, ev, pm); return `${b.picks} 点・${pctOf(b.roi)}（±${pctOf(b.seRoi)}）`; }).join(" | ")} |`);
  const everyCombo = backtest(test, m2, 0, 0.03);
  console.log(`参考: 確率 3% 以上の買い目を全部買うと ${everyCombo.picks} 点・回収率 ${pctOf(everyCombo.roi)}（控除率の水準の確認）`);

  // forward（11/18〜）で使う式を固定する: 7/1〜11/15 の全部で合わせ直した M2
  const freezeAt = args.indexOf("--freeze");
  if (freezeAt >= 0) {
    const all = fit(triRaces.map((r) => r.x.map((row, c) => ({ x: Array.from(row.subarray(0, 1 + 2 * G)), win: (c === r.winner ? 1 : 0) as 0 | 1 }))), 1 + 2 * G);
    writeFileSync(args[freezeAt + 1], `${JSON.stringify({
      name: "育成枠の第 1 版（M2: 市場の 3連単の確率 + 1着・2着の艇の材料）",
      fittedOn: { from: FROM, to: TO, races: triRaces.length },
      score: "買い目 a-b-c の点数 = gamma × log(市場補正の 3連単の確率) + Σ first[i] × 材料_i(a) + Σ second[i] × 材料_i(b)。確率は 120 通りの softmax",
      features: names,
      gamma: all.beta[0], first: all.beta.slice(1, 1 + G), second: all.beta.slice(1 + G, 1 + 2 * G),
      laneAffinitySdByLane: [1, 2, 3, 4, 5, 6].map((lane) => laneSd.get(lane)),
      scales: Object.fromEntries(V1.map((name) => [name, scales.get(name)])),
      betRule: { minExpectedValue: 1.2, minProbability: 0.03, oddsAt: "締切5分前", stakeYen: 100 },
      definitions: "docs/reviews/2026-11-17-second-prediction-track.md と scripts/review-20261117-factor-residual.ts",
    }, null, 2)}\n`);
    log(`固定した式を書き出した: ${args[freezeAt + 1]}`);
  }
}
