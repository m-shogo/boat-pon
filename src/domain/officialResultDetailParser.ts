// 公式結果ファイル（K******.TXT, Shift_JIS）から全項目を抽出する包括パーサー。
// 既存 officialResultParser.ts は3連単のみ。こちらは気象・各艇成績・決まり手・全馬券種を取る。
// 2000-2026の k*.lzh アーカイブを再パースして全期間backtestを可能にするのが目的。

const VENUE_ALIASES: Record<string, string> = { 琵琶湖: "びわこ" };
const normalizeVenue = (v: string) => VENUE_ALIASES[v] ?? v;

function normalizeWeather(raw: string): string | null {
  const w = raw.replace(/[\s　]/g, "");
  if (!w) return null;
  if (w.startsWith("晴")) return "晴";
  if (w.startsWith("曇")) return "曇";
  if (w.startsWith("雨")) return "雨";
  if (w.startsWith("雪")) return "雪";
  if (w.startsWith("霧")) return "霧";
  return w;
}

function normalizeWindDir(raw: string): string | null {
  const w = raw.replace(/[\s　]/g, "");
  if (!w || w === "無風") return w === "無風" ? "無風" : null;
  return w;
}

function normalizeKimarite(raw: string): string | null {
  const k = raw.replace(/[\s　]/g, "");
  return k || null;
}

export type BetType = "win" | "place" | "exacta" | "quinella" | "wide" | "trifecta" | "trio";

export type RacePayout = {
  raceId: string; date: string; venue: string; raceNo: number;
  betType: BetType; combination: string;
  payoutYen: number | null; popularity: number | null;
  returned: boolean; source: string; fetchedAt: string;
};

export type RaceCondition = {
  raceId: string; date: string; venue: string; raceNo: number;
  raceType: string | null; distanceM: number | null;
  weather: string | null; windDir: string | null; windMps: number | null; waveCm: number | null;
  kimarite: string | null; returned: boolean; source: string; fetchedAt: string;
};

export type RaceEntry = {
  raceId: string; date: string; venue: string; raceNo: number;
  finishPos: number | null;   // 1-6。未完走/失格は null
  statusCode: string | null;  // F/L/S0/K0等（完走時は null）
  boat: number;               // 艇番（枠）
  racerReg: string | null; racerName: string | null;
  motorNo: number | null; boatNo: number | null;
  exhibitionTime: number | null; entryCourse: number | null;  // 進入コース
  st: number | null; stFlying: boolean;
  source: string; fetchedAt: string;
};

export type ParsedResultDetail = {
  conditions: RaceCondition[];
  entries: RaceEntry[];
  payouts: RacePayout[];
};

const TWO_DIGIT: Array<{ label: string; betType: BetType }> = [
  { label: "２連単", betType: "exacta" },
  { label: "２連複", betType: "quinella" },
  { label: "拡連複", betType: "wide" },
];
const THREE_DIGIT: Array<{ label: string; betType: BetType }> = [
  { label: "３連単", betType: "trifecta" },
  { label: "３連複", betType: "trio" },
];
const SPECIAL_PAYOUT_LABELS: Record<string, BetType> = {
  単勝: "win",
  複勝: "place",
  "２連単": "exacta",
  "２連複": "quinella",
  拡連複: "wide",
  "３連単": "trifecta",
  "３連複": "trio",
};

export function parseOfficialResultDetail(
  text: string,
  defaults: { date: string; fetchedAt: string },
): ParsedResultDetail {
  const conditions: RaceCondition[] = [];
  const entries: RaceEntry[] = [];
  const payouts: RacePayout[] = [];
  const lines = text.split(/\r?\n/);

  let venue: string | null = null;
  let date = defaults.date;
  let raceNo: number | null = null;
  let returned = false;
  let continuationBetType: "wide" | null = null;

  const raceId = () => `${date.replaceAll("-", "")}-${venue}-${String(raceNo).padStart(2, "0")}`;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, " ");

    const venueMatch = line.match(/^(.+?)［成績］/);
    if (venueMatch) { venue = normalizeVenue(venueMatch[1].replace(/[\s　]/g, "")); continue; }

    const dateMatch = line.match(/(\d{4})\/\s*(\d{1,2})\/\s*(\d{1,2})/);
    if (dateMatch && line.includes("ボートレース")) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
      continue;
    }

    // 気象ヘッダ行 = レース開始: "1R 予選 H1800m 晴れ 風 西 1m 波 0cm"
    // raceType は「予　選」のように全角スペースを含むため (.+?) で H の前まで取る（\sは全角スペースを含む）
    const condM = line.match(
      /^\s*(\d{1,2})R\s+(.+?)\s+H(\d+)m\s+(\S+?)\s+風\s+(\S+?)\s+(\d+)m\s+波\s+(\d+)cm/,
    );
    if (condM && venue) {
      raceNo = Number(condM[1]);
      returned = false;
      conditions.push({
        raceId: raceId(), date, venue, raceNo,
        raceType: condM[2].replace(/[\s　]/g, "") || null,
        distanceM: Number(condM[3]),
        weather: normalizeWeather(condM[4]),
        windDir: normalizeWindDir(condM[5]),
        windMps: Number(condM[6]),
        waveCm: Number(condM[7]),
        kimarite: null, // カラムヘッダ行で後から埋める
        returned: false, source: "official", fetchedAt: defaults.fetchedAt,
      });
      continue;
    }

    // カラムヘッダ行: 末尾に決まり手
    if (line.includes("登番") && line.includes("ﾚｰｽﾀｲﾑ")) {
      const km = line.replace(/.*ﾚｰｽﾀｲﾑ/, "");
      const k = normalizeKimarite(km);
      if (k && conditions.length > 0 && conditions[conditions.length - 1].raceNo === raceNo) {
        conditions[conditions.length - 1].kimarite = k;
      }
      continue;
    }

    // 「不成立」はrace-wide返還だが、「特払い」は券種別の払戻（通常70円）であり返還ではない。
    // 特払いをここでreturnedにすると、同じrace内の後続の正常払戻までrefundへ汚染する。
    if (raceNo != null && line.includes("不成立")) {
      returned = true;
      if (conditions.length > 0 && conditions[conditions.length - 1].raceNo === raceNo) {
        conditions[conditions.length - 1].returned = true;
      }
    }

    // 各艇成績行: "  01  6 3977 山　本　兼　士 80   80  6.96   6    0.05     1.50.8"
    //            着順 艇 登番 名前 モーター ボート 展示 進入 ST レースタイム
    const entM = line.match(
      /^\s{2}(\S{1,2})\s+([1-6])\s+(\d{4})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(\d+\.\d+)\s+([1-6])\s+(F?\d+\.\d+|L|[^\s　]+)?/,
    );
    if (entM && venue && raceNo != null) {
      const posRaw = entM[1];
      const finishPos = /^0?[1-6]$/.test(posRaw) ? Number(posRaw) : null;
      const statusCode = finishPos == null ? posRaw : null;
      const stRaw = entM[9] ?? "";
      const stFlying = stRaw.startsWith("F");
      const stNum = stRaw.replace(/^F/, "");
      const st = /^\d+\.\d+$/.test(stNum) ? Number(stNum) : null;
      entries.push({
        raceId: raceId(), date, venue, raceNo,
        finishPos, statusCode,
        boat: Number(entM[2]),
        racerReg: entM[3] ?? null,
        racerName: entM[4]?.replace(/[\s　]/g, "") || null,
        motorNo: Number(entM[5]), boatNo: Number(entM[6]),
        exhibitionTime: Number(entM[7]),
        entryCourse: Number(entM[8]),
        st, stFlying,
        source: "official", fetchedAt: defaults.fetchedAt,
      });
      continue;
    }

    // 馬券種行
    const pushPay = (betType: BetType, combo: string, payRaw: string, popRaw: string | null) => {
      if (!venue || raceNo == null) return;
      const payoutYen = Number(payRaw.replaceAll(",", ""));
      const popularity = popRaw != null ? Number(popRaw) : null;
      payouts.push({
        raceId: raceId(), date, venue, raceNo, betType, combination: combo,
        payoutYen: Number.isFinite(payoutYen) && payoutYen > 0 ? payoutYen : null,
        popularity: popularity != null && Number.isFinite(popularity) && popularity > 0 ? popularity : null,
        returned, source: "official", fetchedAt: defaults.fetchedAt,
      });
    };
    // 的中票0の特払いは、その券種を買った全selectionへの払戻。返還（100円）とは分離し、
    // sourceに明記された金額だけをspecial_payoutとして保持する（値の推測補完はしない）。
    const specialPayout = line.match(
      /(単勝|複勝|２連単|２連複|拡連複|３連単|３連複)[\s　]+特払(?:い)?[\s　]+([0-9,]+)/,
    );
    if (specialPayout) {
      pushPay(SPECIAL_PAYOUT_LABELS[specialPayout[1]], "特払", specialPayout[2], null);
      continue;
    }
    const win = line.match(/単勝[\s　]+([1-6])[\s　]+([0-9,]+)/);
    if (win) pushPay("win", win[1], win[2], null);
    if (line.includes("複勝")) {
      const tail = line.slice(line.indexOf("複勝") + 2);
      for (const match of tail.matchAll(/([1-6])[\s　]+([0-9,]+)/g)) {
        pushPay("place", match[1], match[2], null);
      }
    }
    if (continuationBetType === "wide" && !line.includes("拡連複")) {
      const continuation = line.match(/^\s+(\d)-(\d)[\s　]+([0-9,]+)[\s　]+人気[\s　]+(\d+)/);
      if (continuation) {
        pushPay("wide", `${continuation[1]}-${continuation[2]}`, continuation[3], continuation[4]);
      } else if (!line.trim()) {
        continuationBetType = null;
      }
    }
    for (const { label, betType } of TWO_DIGIT) {
      const m = line.match(new RegExp(`${label}[\\s　]+(\\d)-(\\d)[\\s　]+([0-9,]+)[\\s　]+人気[\\s　]+(\\d+)`));
      if (m) {
        pushPay(betType, `${m[1]}-${m[2]}`, m[3], m[4]);
        continuationBetType = betType === "wide" ? "wide" : null;
      }
    }
    for (const { label, betType } of THREE_DIGIT) {
      const m = line.match(new RegExp(`${label}[\\s　]+(\\d)-(\\d)-(\\d)[\\s　]+([0-9,]+)[\\s　]+人気[\\s　]+(\\d+)`));
      if (m) {
        continuationBetType = null;
        pushPay(betType, `${m[1]}-${m[2]}-${m[3]}`, m[4], m[5]);
      }
    }
    // 旧形式(2000-2002頃, 3連単導入前): 行頭アンカーで「連単/連複」(=2連単/2連複)。
    // 新形式「２連単」は行頭直後が全角２なのでマッチしない。
    const oldM = line.match(/^\s+連(単|複)\s+(\d)-(\d)\s+([0-9,]+)\s+人気\s+(\d+)/);
    if (oldM) {
      pushPay(oldM[1] === "単" ? "exacta" : "quinella", `${oldM[2]}-${oldM[3]}`, oldM[4], oldM[5]);
    }
    // 旧形式の決まり手は払戻行末尾「決まり手 逃げ」。直近conditionに記録。
    const oldKm = line.match(/決まり手[\s　]+(\S+)/);
    if (oldKm && conditions.length > 0 && conditions[conditions.length - 1].raceNo === raceNo
        && !conditions[conditions.length - 1].kimarite) {
      conditions[conditions.length - 1].kimarite = normalizeKimarite(oldKm[1]);
    }
  }

  return { conditions, entries, payouts };
}
