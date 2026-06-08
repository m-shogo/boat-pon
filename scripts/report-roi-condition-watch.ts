/**
 * ROI条件監視レポート
 *
 * paper_roi_candidates (current_odds基準) を historical / forward で比較し、
 * headF / 月 / race_no / 会場 / wind_mps / odds帯ごとに
 * BUY削減候補・監視候補・捨て候補を分類する。
 *
 * - DB への書き込み一切なし
 * - current_odds基準でROI計算 (paper_roi_candidates内)
 * - headF比較のみ payout_yen 基準 (race_payouts) を使用し明記
 * - n<30 は採用判断しない
 *
 * usage:
 *   pnpm report:roi-condition-watch
 */

import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/boat.sqlite";
const FORWARD_START = "2025-08-09";
const REPORT_MD = "reports/roi-condition-watch.md";
const REPORT_JSON = "reports/roi-condition-watch.json";

const COND_ISBASE = "seasonal_parts0_month_4_6_8_12";
const COND_WIND5 = "seasonal_parts0_month_4_6_8_12_wind5";

const N_MIN_ADOPT = 100;   // historical強め候補最低n
const N_MIN_ADOPT_SOFT = 50; // hits>=5 + ROI条件を満たす場合の下限n
const HITS_MIN_ADOPT = 5;    // historical強め候補最低hit数
const N_MIN_WATCH = 30;      // 監視候補最低n
const ROI_ADOPT = 150;       // historical強め候補最低ROI%
const ROI_WATCH = 100;       // 監視最低ROI%

// ── 型定義 ─────────────────────────────────────────────────────────────────

type Period = "historical" | "forward" | "all";
type Verdict = "historical強め候補" | "監視候補+" | "監視候補" | "historical弱め候補";

type GroupStat = {
  label: string;
  n: number;
  hits: number;
  hitRate: number;
  avgOdds: number;
  roi: number;
  verdict: Verdict;
  note: string;
};

type DimSection = {
  dimension: string;
  condition: string;
  historical: GroupStat[];
  forward: GroupStat[];
};

type HeadFRow = {
  group: string;
  n: number;
  hits: number;
  hitRatePct: number;
  avgPayoutYen: number;
  roiPct: number;
};

type ConditionOverview = {
  condition: string;
  period: Period;
  n: number;
  hits: number;
  hitRatePct: number;
  avgOdds: number;
  roi: number;
  roiPayoutYen: number;
};

type Report = {
  generatedAt: string;
  forwardStart: string;
  overview: ConditionOverview[];
  headFComparison: HeadFRow[];
  dimensions: DimSection[];
  verdictSummary: { verdict: Verdict; groups: string[] }[];
};

// ── ヘルパー ───────────────────────────────────────────────────────────────

function roiVal(sumOdds: number, n: number): number {
  if (n === 0) return 0;
  return Math.round((sumOdds / n) * 100 * 10) / 10;
}

function hitRate(hits: number, n: number): number {
  if (n === 0) return 0;
  return Math.round((hits / n) * 100 * 10) / 10;
}

function verdict(roi: number, n: number, hits: number): Verdict {
  if (n < N_MIN_WATCH) return "監視候補";
  if (roi < ROI_WATCH) return "historical弱め候補";
  const strongEnough =
    (n >= N_MIN_ADOPT && hits >= HITS_MIN_ADOPT) ||
    (n >= N_MIN_ADOPT_SOFT && hits >= HITS_MIN_ADOPT);
  if (roi >= ROI_ADOPT && strongEnough) return "historical強め候補";
  if (roi >= ROI_WATCH) return "監視候補+";
  return "監視候補";
}

function verdictIcon(v: Verdict): string {
  return {
    "historical強め候補": "🟢",
    "監視候補+": "🟡",
    "監視候補": "⚪",
    "historical弱め候補": "🔴",
  }[v];
}

// ── クエリ ─────────────────────────────────────────────────────────────────

function queryOverview(db: DatabaseSync): ConditionOverview[] {
  const rows = db.prepare(`
    SELECT
      p.condition_name,
      CASE WHEN p.date >= ? THEN 'forward' ELSE 'historical' END as period,
      COUNT(*) as n,
      SUM(p.hit) as hits,
      ROUND(AVG(p.current_odds), 2) as avg_odds,
      SUM(p.hit * p.current_odds) as sum_odds,
      SUM(COALESCE(rp.payout_yen, 0)) * 1.0 / COUNT(*) as roi_payout
    FROM paper_roi_candidates p
    LEFT JOIN race_payouts rp
      ON rp.race_id = p.race_id AND rp.bet_type = 'trifecta' AND rp.combination = p.selection
    GROUP BY p.condition_name, period
    ORDER BY p.condition_name, period
  `).all(FORWARD_START) as Array<Record<string, number | string>>;

  return rows.map((r) => ({
    condition: r.condition_name as string,
    period: r.period as Period,
    n: r.n as number,
    hits: r.hits as number,
    hitRatePct: hitRate(r.hits as number, r.n as number),
    avgOdds: r.avg_odds as number,
    roi: roiVal(r.sum_odds as number, r.n as number),
    roiPayoutYen: Math.round((r.roi_payout as number) * 10) / 10,
  }));
}

function queryHeadF(db: DatabaseSync): HeadFRow[] {
  const rows = db.prepare(`
    WITH filtered_races AS (
      SELECT rc.race_id,
        COALESCE(rp.flying_count, 0) as f_count,
        payo.payout_yen
      FROM race_conditions rc
      JOIN race_entries re ON re.race_id = rc.race_id AND re.boat = 1
      LEFT JOIN racer_profiles rp ON rp.registration_no = re.racer_reg
      JOIN race_equipment req
        ON req.race_id = rc.race_id AND req.course = 1 AND req.parts_changed_count = 0
      JOIN exhibition_data ed
        ON ed.race_id = rc.race_id AND ed.course = 1
        AND (ed.start_timing < 0.10 OR ed.start_timing >= 0.15)
      LEFT JOIN race_payouts payo
        ON payo.race_id = rc.race_id AND payo.bet_type = 'trifecta' AND payo.combination = '1-2-3'
      WHERE strftime('%m', rc.date) IN ('04','06','08','12')
        AND rc.race_no < 10
        AND rc.venue NOT IN ('戸田','多摩川')
        AND rc.wind_mps >= 3
        AND rc.date >= '2024-04-01'
    )
    SELECT
      CASE WHEN f_count = 0 THEN 'headF=0' ELSE 'headF>=1' END as grp,
      COUNT(*) as n,
      SUM(CASE WHEN payout_yen IS NOT NULL THEN 1 ELSE 0 END) as hits,
      ROUND(SUM(CASE WHEN payout_yen IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as hit_rate,
      ROUND(SUM(COALESCE(payout_yen, 0)) * 1.0 / COUNT(*), 1) as avg_payout,
      ROUND(SUM(COALESCE(payout_yen, 0)) * 1.0 / COUNT(*), 1) as roi_pct
    FROM filtered_races GROUP BY grp
    ORDER BY grp
  `).all() as Array<Record<string, number | string>>;

  return rows.map((r) => ({
    group: r.grp as string,
    n: r.n as number,
    hits: r.hits as number,
    hitRatePct: r.hit_rate as number,
    avgPayoutYen: r.avg_payout as number,
    roiPct: r.roi_pct as number,
  }));
}

type RawDimRow = {
  label: string;
  n: number;
  hits: number;
  sum_odds: number;
  avg_odds: number;
};

function queryDim(
  db: DatabaseSync,
  condition: string,
  period: Period,
  caseSql: string,
  orderSql: string
): GroupStat[] {
  const periodCond =
    period === "historical"
      ? `AND date < '${FORWARD_START}'`
      : period === "forward"
      ? `AND date >= '${FORWARD_START}'`
      : "";

  const rows = db.prepare(`
    SELECT
      ${caseSql} as label,
      COUNT(*) as n,
      SUM(hit) as hits,
      SUM(hit * current_odds) as sum_odds,
      ROUND(AVG(current_odds), 1) as avg_odds
    FROM paper_roi_candidates
    WHERE condition_name = ? ${periodCond}
    GROUP BY label
    ORDER BY ${orderSql}
  `).all(condition) as RawDimRow[];

  return rows.map((r) => {
    const roi = roiVal(r.sum_odds, r.n);
    const v = verdict(roi, r.n, r.hits);
    const note =
      r.n < N_MIN_WATCH
        ? `n=${r.n} (n<${N_MIN_WATCH}のため判断不可)`
        : r.n < N_MIN_ADOPT && v !== "historical弱め候補"
        ? `n=${r.n} (n<${N_MIN_ADOPT}のため注意)`
        : "";
    return {
      label: r.label,
      n: r.n,
      hits: r.hits,
      hitRate: hitRate(r.hits, r.n),
      avgOdds: r.avg_odds,
      roi,
      verdict: v,
      note,
    };
  });
}

// ── 各次元クエリ ───────────────────────────────────────────────────────────

const MONTH_CASE = `CASE strftime('%m', date)
  WHEN '04' THEN '04月'
  WHEN '06' THEN '06月'
  WHEN '08' THEN '08月'
  WHEN '12' THEN '12月'
  ELSE 'other' END`;

const RACE_NO_CASE = `CASE
  WHEN race_no BETWEEN 1 AND 3 THEN 'R1-3'
  WHEN race_no BETWEEN 4 AND 6 THEN 'R4-6'
  ELSE 'R7-9'
END`;

const WIND_CASE = `CASE
  WHEN wind_mps < 5.0 THEN '3.0-4.9m'
  WHEN wind_mps < 7.0 THEN '5.0-6.9m'
  ELSE '>=7.0m'
END`;

const ODDS_CASE = `CASE
  WHEN current_odds < 30 THEN '<30'
  WHEN current_odds < 40 THEN '30-40'
  WHEN current_odds < 50 THEN '40-50'
  WHEN current_odds < 60 THEN '50-60'
  ELSE '>=60'
END`;

const EXST_CASE = `CASE
  WHEN ex_st < 0.10 THEN '<0.10(早め)'
  ELSE '>=0.15(通常)'
END`;

// ── メイン ────────────────────────────────────────────────────────────────

function run(): Report {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");

  try {
    const overview = queryOverview(db);
    const headFComparison = queryHeadF(db);

    const dimensions: DimSection[] = [];

    for (const [cond, label] of [
      [COND_ISBASE, "isBase"],
      [COND_WIND5, "wind5"],
    ] as [string, string][]) {
      // 月別
      dimensions.push({
        dimension: "月",
        condition: label,
        historical: queryDim(db, cond, "historical", MONTH_CASE, "label"),
        forward: queryDim(db, cond, "forward", MONTH_CASE, "label"),
      });

      // race_no帯
      dimensions.push({
        dimension: "race_no帯",
        condition: label,
        historical: queryDim(db, cond, "historical", RACE_NO_CASE, "MIN(race_no)"),
        forward: queryDim(db, cond, "forward", RACE_NO_CASE, "MIN(race_no)"),
      });

      // wind_mps帯
      dimensions.push({
        dimension: "wind_mps帯",
        condition: label,
        historical: queryDim(db, cond, "historical", WIND_CASE, "MIN(wind_mps)"),
        forward: queryDim(db, cond, "forward", WIND_CASE, "MIN(wind_mps)"),
      });

      // odds帯
      dimensions.push({
        dimension: "odds帯",
        condition: label,
        historical: queryDim(db, cond, "historical", ODDS_CASE, "MIN(current_odds)"),
        forward: queryDim(db, cond, "forward", ODDS_CASE, "MIN(current_odds)"),
      });

      // ex_st帯
      dimensions.push({
        dimension: "ex_st帯",
        condition: label,
        historical: queryDim(db, cond, "historical", EXST_CASE, "MIN(ex_st)"),
        forward: queryDim(db, cond, "forward", EXST_CASE, "MIN(ex_st)"),
      });

      // 会場 (historical n>=10のみ意味がある)
      dimensions.push({
        dimension: "会場",
        condition: label,
        historical: queryDim(db, cond, "historical", "venue", "venue"),
        forward: queryDim(db, cond, "forward", "venue", "venue"),
      });
    }

    // verdict summary
    const verdictMap = new Map<Verdict, string[]>();
    for (const sec of dimensions) {
      for (const gs of [...sec.historical]) {
        if (gs.n >= N_MIN_WATCH) {
          const key = `[${sec.condition}/${sec.dimension}] ${gs.label} (n=${gs.n}, ROI=${gs.roi}%)`;
          const arr = verdictMap.get(gs.verdict) ?? [];
          arr.push(key);
          verdictMap.set(gs.verdict, arr);
        }
      }
    }

    const verdictSummary: Report["verdictSummary"] = [];
    for (const v of ["historical強め候補", "監視候補+", "監視候補", "historical弱め候補"] as Verdict[]) {
      verdictSummary.push({ verdict: v, groups: verdictMap.get(v) ?? [] });
    }

    db.close();

    return {
      generatedAt: new Date().toISOString(),
      forwardStart: FORWARD_START,
      overview,
      headFComparison,
      dimensions,
      verdictSummary,
    };
  } catch (e) {
    db.close();
    throw e;
  }
}

// ── Markdown生成 ──────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toFixed(1);
}

function statRow(gs: GroupStat): string {
  const v = `${verdictIcon(gs.verdict)} ${gs.verdict}`;
  const noteStr = gs.note ? ` *(${gs.note})*` : "";
  return `| ${gs.label} | ${gs.n} | ${gs.hits} | ${num(gs.hitRate)}% | ${num(gs.avgOdds)} | ${num(gs.roi)}% | ${v}${noteStr} |`;
}

function dimTable(stats: GroupStat[], title: string): string[] {
  const lines: string[] = [];
  if (stats.length === 0) {
    lines.push(`${title}: データなし`);
    return lines;
  }
  lines.push(`**${title}**`);
  lines.push("");
  lines.push("| グループ | n | hit | hitRate | avgOdds | ROI | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const gs of stats) {
    lines.push(statRow(gs));
  }
  return lines;
}

function generateMarkdown(r: Report): string {
  const lines: string[] = [];

  lines.push("# ROI条件監視レポート");
  lines.push("");
  lines.push(`生成日時: ${r.generatedAt}`);
  lines.push(`forward期間: ${r.forwardStart} 以降`);
  lines.push("");
  lines.push("> ROIはすべて current_odds 基準。headF比較のみ race_payouts (payout_yen) 基準で別表記。");
  lines.push("> n<30 は判断不可。判定名は historical 上の傾向を示すもので、BUY設定への採用可否ではない。");
  lines.push("");

  // 全体概況
  lines.push("## 全体概況");
  lines.push("");
  lines.push("| 条件 | 期間 | n | hit | hitRate | avgOdds | ROI(current_odds) | ROI(payout_yen) |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const ov of r.overview) {
    const condLabel = ov.condition === COND_ISBASE ? "isBase" : "wind5";
    lines.push(
      `| ${condLabel} | ${ov.period} | ${ov.n} | ${ov.hits} | ${num(ov.hitRatePct)}% | ${num(ov.avgOdds)} | ${num(ov.roi)}% | ${num(ov.roiPayoutYen)}% |`
    );
  }
  lines.push("");

  // headF比較
  lines.push("## headF比較 (payout_yen基準・isBase条件全適用)");
  lines.push("");
  lines.push("> **参考比較 (payout_yen基準)**: isBaseの全フィルター (parts=0, exSt除外, month/venue/race_no/wind) を");
  lines.push("> 適用した上で headF のみを変えた場合の 1-2-3 trifecta 払戻 (payout_yen÷100) を ROI として比較。");
  lines.push("> current_odds 基準とは計算方法が異なるため、BUY削減ルールとして採用するには");
  lines.push("> paper_roi_candidates 上での追加検証が別途必要。対象期間: 2024-04-01 以降。");
  lines.push("");
  lines.push("| グループ | n | hit | hitRate | avg payout(yen) | ROI(payout参考) |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const hf of r.headFComparison) {
    lines.push(
      `| ${hf.group} | ${hf.n} | ${hf.hits} | ${num(hf.hitRatePct)}% | ${num(hf.avgPayoutYen)} | ${num(hf.roiPct)}% |`
    );
  }
  lines.push("");
  lines.push("> 傾向: 1-2-3 の hit率はheadF=0/>=1 で大きく変わらない。ROI差はオッズ水準の違いによる部分が大きく、");
  lines.push("> headF フィルター単体の効果か他フィルターとの交互作用かはこのデータだけでは判断できない。");
  lines.push("");

  // 次元別
  const condGroups = [COND_ISBASE, COND_WIND5];
  const condLabels: Record<string, string> = { [COND_ISBASE]: "isBase", [COND_WIND5]: "wind5" };

  for (const cond of condGroups) {
    const label = condLabels[cond];
    const secs = r.dimensions.filter((d) => d.condition === label);

    lines.push(`## ${label} 次元別分析`);
    lines.push("");

    for (const sec of secs) {
      lines.push(`### ${label} / ${sec.dimension}`);
      lines.push("");

      // historical
      lines.push(...dimTable(sec.historical, `historical (〜${FORWARD_START}前日)`));
      lines.push("");

      // forward
      if (sec.forward.some((g) => g.n > 0)) {
        lines.push(...dimTable(sec.forward, `forward (${FORWARD_START}〜)`));
        lines.push("");
      } else {
        lines.push(`forward: データなし (n=0)`);
        lines.push("");
      }
    }
  }

  // verdict summary
  lines.push("## 傾向サマリー (historical n>=30)");
  lines.push("");
  lines.push("> ⚠️ **判定名について**: 「historical強め候補」「historical弱め候補」は historical データ上の ROI 傾向を示すラベルであり、");
  lines.push("> BUY設定への採用可否ではない。採用判断には forward n>=30 の蓄積と paper_roi_candidates 上の追加検証が必要。");
  lines.push("> historical n>=30 の区分のみ掲載。forward は n が小さいため参考扱い。");
  lines.push("");
  for (const vs of r.verdictSummary) {
    lines.push(`### ${verdictIcon(vs.verdict)} ${vs.verdict}`);
    lines.push("");
    if (vs.groups.length === 0) {
      lines.push("該当なし");
    } else {
      for (const g of vs.groups) {
        lines.push(`- ${g}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── 実行 ──────────────────────────────────────────────────────────────────

const report = run();

const md = generateMarkdown(report);
writeFileSync(REPORT_MD, md, "utf8");
writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(md);
console.log(`\n→ ${REPORT_MD}`);
console.log(`→ ${REPORT_JSON}`);
