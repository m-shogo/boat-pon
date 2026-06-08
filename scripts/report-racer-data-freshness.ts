/**
 * 選手データ鮮度レポート
 *
 * racer_profiles / racer_course_stats の鮮度を確認し、
 * isBase / wind5 対象選手の flying_count 信頼性と launchd 稼働状況を報告する。
 *
 * 読み取り専用診断スクリプト。DB への書き込みは一切行わない。
 *
 * usage:
 *   pnpm report:racer-freshness
 */

import { execSync } from "node:child_process";
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/boat.sqlite";
const FORWARD_START = "2025-08-09";
const STALE_DAYS_WARN = 7;
const STALE_DAYS_CRIT = 14;
const LOG_PATH = "data/logs/weekly-racer-stats.log";
const ERR_LOG_PATH = "data/logs/weekly-racer-stats-err.log";
const REPORT_MD = "reports/racer-data-freshness.md";
const REPORT_JSON = "reports/racer-data-freshness.json";
const LAUNCHD_LABEL = "com.boatpon.weekly-racer-stats";

type FreshnessStats = {
  total: number;
  distinctRacers: number;
  maxFetchedAt: string | null;
  minFetchedAt: string | null;
  over7Days: number;
  over14Days: number;
  nullFetchedAt: number;
};

type RacerFreshnessDetail = {
  label: string;
  totalRacers: number;
  stale7: number;
  flyingCountNull: number;
  notInProfiles: number;
  headFImpacted: number;
};

type ForwardPeriodMeta = {
  minDate: string | null;
  maxDate: string | null;
  raceCount: number;
};

type LaunchdStatus = {
  loaded: boolean;
  label: string;
  schedule: string;
};

type LogStatus = {
  exists: boolean;
  lastModified: string | null;
  lastLines: string[];
  errExists: boolean;
  errLastModified: string | null;
  errLastLines: string[];
};

type RecommendedAction =
  | "NO_ACTION"
  | "MONITOR"
  | "RUN_FETCH"
  | "INVESTIGATE";

type FreshnessReport = {
  generatedAt: string;
  profiles: FreshnessStats;
  courseStats: FreshnessStats;
  recentIsBase: RacerFreshnessDetail;
  recentWind5: RacerFreshnessDetail;
  forwardPeriod: RacerFreshnessDetail;
  forwardPeriodMeta: ForwardPeriodMeta;
  launchd: LaunchdStatus;
  log: LogStatus;
  flyingCountReliability: "HIGH" | "MEDIUM" | "LOW";
  flyingCountReliabilityReason: string;
  fetchNeededNow: boolean;
  fetchNeededReason: string;
  recommendedAction: RecommendedAction;
  recommendedActionDetail: string;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "なし";
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function queryFreshness(db: DatabaseSync, table: string): FreshnessStats {
  const hasDistinct = table === "racer_course_stats";
  const r = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      ${hasDistinct ? "COUNT(DISTINCT registration_no)" : "COUNT(*)"} as distinct_racers,
      MAX(fetched_at) as max_fetched,
      MIN(fetched_at) as min_fetched,
      SUM(CASE WHEN fetched_at IS NOT NULL AND julianday(fetched_at) < julianday('now', '-${STALE_DAYS_WARN} days') THEN 1 ELSE 0 END) as over7,
      SUM(CASE WHEN fetched_at IS NOT NULL AND julianday(fetched_at) < julianday('now', '-${STALE_DAYS_CRIT} days') THEN 1 ELSE 0 END) as over14,
      SUM(CASE WHEN fetched_at IS NULL THEN 1 ELSE 0 END) as null_count
    FROM ${table}
  `
    )
    .get() as Record<string, number | string | null>;

  return {
    total: r.total as number,
    distinctRacers: r.distinct_racers as number,
    maxFetchedAt: r.max_fetched as string | null,
    minFetchedAt: r.min_fetched as string | null,
    over7Days: r.over7 as number,
    over14Days: r.over14 as number,
    nullFetchedAt: r.null_count as number,
  };
}

function queryRacerDetail(
  db: DatabaseSync,
  label: string,
  condition: string
): RacerFreshnessDetail {
  const r = db
    .prepare(
      `
    WITH target_racers AS (
      SELECT DISTINCT re.racer_reg as reg_no
      FROM race_entries re
      JOIN race_conditions rc ON rc.race_id = re.race_id
      WHERE re.boat = 1
        AND re.racer_reg IS NOT NULL
        AND ${condition}
    )
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN p.registration_no IS NULL THEN 1 ELSE 0 END) as not_in_profiles,
      SUM(CASE WHEN p.flying_count IS NULL AND p.registration_no IS NOT NULL THEN 1 ELSE 0 END) as fnull,
      SUM(CASE WHEN p.fetched_at IS NOT NULL AND julianday(p.fetched_at) < julianday('now', '-${STALE_DAYS_WARN} days') THEN 1 ELSE 0 END) as stale7
    FROM target_racers tr
    LEFT JOIN racer_profiles p ON p.registration_no = tr.reg_no
  `
    )
    .get() as Record<string, number>;

  const fnull = r.fnull;
  const notInProfiles = r.not_in_profiles;
  // flying_count NULLは headF=0 扱いになるため、判定に影響する可能性がある
  const headFImpacted = fnull + notInProfiles;

  return {
    label,
    totalRacers: r.total,
    stale7: r.stale7,
    flyingCountNull: fnull,
    notInProfiles,
    headFImpacted,
  };
}

function queryForwardDetail(
  db: DatabaseSync
): { detail: RacerFreshnessDetail; meta: ForwardPeriodMeta } {
  const r = db
    .prepare(
      `
    WITH forward_racers AS (
      SELECT DISTINCT re.racer_reg as reg_no
      FROM race_entries re
      JOIN paper_roi_candidates pc ON pc.race_id = re.race_id
      WHERE re.boat = 1
        AND re.racer_reg IS NOT NULL
        AND pc.date >= '${FORWARD_START}'
    )
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN rp.registration_no IS NULL THEN 1 ELSE 0 END) as not_in_profiles,
      SUM(CASE WHEN rp.flying_count IS NULL AND rp.registration_no IS NOT NULL THEN 1 ELSE 0 END) as fnull,
      SUM(CASE WHEN rp.fetched_at IS NOT NULL AND julianday(rp.fetched_at) < julianday('now', '-${STALE_DAYS_WARN} days') THEN 1 ELSE 0 END) as stale7
    FROM forward_racers fr
    LEFT JOIN racer_profiles rp ON rp.registration_no = fr.reg_no
  `
    )
    .get() as Record<string, number>;

  const meta = db
    .prepare(
      `
    SELECT
      MIN(date) as min_date,
      MAX(date) as max_date,
      COUNT(DISTINCT race_id) as race_count
    FROM paper_roi_candidates
    WHERE date >= '${FORWARD_START}'
  `
    )
    .get() as { min_date: string | null; max_date: string | null; race_count: number };

  const fnull = r.fnull;
  const notInProfiles = r.not_in_profiles;

  return {
    detail: {
      label: `paper forward期間 (${FORWARD_START}以降)`,
      totalRacers: r.total,
      stale7: r.stale7,
      flyingCountNull: fnull,
      notInProfiles,
      headFImpacted: fnull + notInProfiles,
    },
    meta: {
      minDate: meta.min_date,
      maxDate: meta.max_date,
      raceCount: meta.race_count,
    },
  };
}

function checkLaunchd(): LaunchdStatus {
  try {
    const out = execSync(`launchctl list | grep "${LAUNCHD_LABEL}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return {
      loaded: out.length > 0,
      label: LAUNCHD_LABEL,
      schedule: "毎週月曜 05:00 JST",
    };
  } catch {
    return {
      loaded: false,
      label: LAUNCHD_LABEL,
      schedule: "毎週月曜 05:00 JST",
    };
  }
}

function checkLog(): LogStatus {
  const logExists = existsSync(LOG_PATH);
  const errExists = existsSync(ERR_LOG_PATH);

  let lastModified: string | null = null;
  let lastLines: string[] = [];
  if (logExists) {
    const stat = statSync(LOG_PATH);
    lastModified = stat.mtime.toISOString();
    const content = readFileSync(LOG_PATH, "utf8");
    lastLines = content.trim().split("\n").slice(-5);
  }

  let errLastModified: string | null = null;
  let errLastLines: string[] = [];
  if (errExists) {
    const stat = statSync(ERR_LOG_PATH);
    errLastModified = stat.mtime.toISOString();
    const content = readFileSync(ERR_LOG_PATH, "utf8");
    errLastLines = content.trim().split("\n").slice(-5);
  }

  return {
    exists: logExists,
    lastModified,
    lastLines,
    errExists,
    errLastModified,
    errLastLines,
  };
}

function assessFlyingCountReliability(
  profiles: FreshnessStats,
  forward: RacerFreshnessDetail
): { reliability: "HIGH" | "MEDIUM" | "LOW"; reason: string } {
  const impactRate =
    forward.totalRacers > 0
      ? forward.headFImpacted / forward.totalRacers
      : 0;

  if (impactRate === 0 && profiles.over14Days === 0) {
    return {
      reliability: "HIGH",
      reason: "forward期間の対象選手全員のflying_countが取得済みで14日超なし",
    };
  }
  if (impactRate < 0.05 && profiles.over14Days === 0) {
    return {
      reliability: "HIGH",
      reason: `forward期間headF影響 ${(impactRate * 100).toFixed(1)}% (5%未満)、14日超なし`,
    };
  }
  if (impactRate < 0.1 || profiles.over14Days < 10) {
    return {
      reliability: "MEDIUM",
      reason: `forward期間headF潜在影響 ${forward.headFImpacted}/${forward.totalRacers}件 または14日超=${profiles.over14Days}件`,
    };
  }
  return {
    reliability: "LOW",
    reason: `forward期間headF潜在影響 ${forward.headFImpacted}/${forward.totalRacers}件 が多い`,
  };
}

function assessFetchNeeded(
  profiles: FreshnessStats,
  courseStats: FreshnessStats,
  log: LogStatus
): { needed: boolean; reason: string } {
  const stale14Parts: string[] = [];
  if (profiles.over14Days > 0) stale14Parts.push(`profiles ${profiles.over14Days}件`);
  if (courseStats.over14Days > 0) stale14Parts.push(`course_stats ${courseStats.over14Days}件`);
  if (stale14Parts.length > 0) {
    return { needed: true, reason: `14日超の古いデータあり: ${stale14Parts.join(", ")}` };
  }

  // ログの最終実行が8日超前なら要確認
  if (log.lastModified) {
    const lastRun = new Date(log.lastModified);
    const daysSince =
      (Date.now() - lastRun.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 8) {
      return {
        needed: true,
        reason: `最終実行から ${daysSince.toFixed(1)}日 経過 (>8日)`,
      };
    }
  } else {
    return { needed: true, reason: "実行ログなし" };
  }

  return { needed: false, reason: "本日または直近実行済み、14日超なし" };
}

function run(): FreshnessReport {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");

  try {
    const profiles = queryFreshness(db, "racer_profiles");
    const courseStats = queryFreshness(db, "racer_course_stats");

    const isBaseCondition = `
      strftime('%m', rc.date) IN ('04','06','08','12')
      AND rc.race_no < 10
      AND rc.venue NOT IN ('戸田','多摩川')
      AND rc.wind_mps >= 3
      AND rc.date >= date('now', '-90 days')
    `;
    const wind5Condition = `
      strftime('%m', rc.date) IN ('04','06','08','12')
      AND rc.race_no < 10
      AND rc.venue NOT IN ('戸田','多摩川')
      AND rc.wind_mps >= 5
      AND rc.date >= date('now', '-90 days')
    `;

    const recentIsBase = queryRacerDetail(db, "isBase (直近90日)", isBaseCondition);
    const recentWind5 = queryRacerDetail(db, "wind5 (直近90日)", wind5Condition);
    const { detail: forwardPeriod, meta: forwardPeriodMeta } = queryForwardDetail(db);

    const launchd = checkLaunchd();
    const log = checkLog();

    const { reliability, reason: reliabilityReason } =
      assessFlyingCountReliability(profiles, forwardPeriod);
    const { needed: fetchNeeded, reason: fetchReason } = assessFetchNeeded(
      profiles,
      courseStats,
      log
    );

    let recommendedAction: RecommendedAction;
    let recommendedActionDetail: string;

    if (!launchd.loaded) {
      recommendedAction = "INVESTIGATE";
      recommendedActionDetail =
        "launchd が未ロード。plist を確認して `launchctl load` を実行してください";
    } else if (fetchNeeded) {
      recommendedAction = "RUN_FETCH";
      recommendedActionDetail = `pnpm fetch:racer-stats を実行 (理由: ${fetchReason})`;
    } else if (profiles.over7Days > 30) {
      recommendedAction = "MONITOR";
      recommendedActionDetail = `7日超=${profiles.over7Days}件あるが引退選手の可能性大。dry-runで確認推奨`;
    } else {
      recommendedAction = "NO_ACTION";
      recommendedActionDetail = "launchd稼働中、データ鮮度は正常範囲。次回自動更新まで待機";
    }

    db.close();

    return {
      generatedAt: new Date().toISOString(),
      profiles,
      courseStats,
      recentIsBase,
      recentWind5,
      forwardPeriod,
      forwardPeriodMeta,
      launchd,
      log,
      flyingCountReliability: reliability,
      flyingCountReliabilityReason: reliabilityReason,
      fetchNeededNow: fetchNeeded,
      fetchNeededReason: fetchReason,
      recommendedAction,
      recommendedActionDetail,
    };
  } catch (e) {
    db.close();
    throw e;
  }
}

function reliabilityIcon(r: "HIGH" | "MEDIUM" | "LOW"): string {
  return { HIGH: "🟢", MEDIUM: "🟡", LOW: "🔴" }[r];
}

function actionIcon(a: RecommendedAction): string {
  return (
    { NO_ACTION: "✅", MONITOR: "👀", RUN_FETCH: "⚠️", INVESTIGATE: "🚨" }[
      a
    ]
  );
}

function generateMarkdown(r: FreshnessReport): string {
  const lines: string[] = [];

  lines.push("# 選手データ鮮度レポート");
  lines.push("");
  lines.push(`生成日時: ${r.generatedAt}`);
  lines.push("");

  lines.push("## サマリー");
  lines.push("");
  lines.push(`| 項目 | 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| racer_profiles 総件数 | ${r.profiles.total} 件 |`);
  lines.push(`| racer_profiles 最新取得 | ${fmtDate(r.profiles.maxFetchedAt)} |`);
  lines.push(`| racer_profiles 最古取得 | ${fmtDate(r.profiles.minFetchedAt)} |`);
  lines.push(`| racer_profiles 7日超 | ${r.profiles.over7Days} 件 |`);
  lines.push(`| racer_profiles 14日超 | ${r.profiles.over14Days} 件 |`);
  lines.push(`| racer_profiles null | ${r.profiles.nullFetchedAt} 件 |`);
  lines.push(`| racer_course_stats 総行数 | ${r.courseStats.total} 行 |`);
  lines.push(`| racer_course_stats 登録選手 | ${r.courseStats.distinctRacers} 人 |`);
  lines.push(`| racer_course_stats 最新取得 | ${fmtDate(r.courseStats.maxFetchedAt)} |`);
  lines.push(`| racer_course_stats 最古取得 | ${fmtDate(r.courseStats.minFetchedAt)} |`);
  lines.push(`| racer_course_stats 7日超 | ${r.courseStats.over7Days} 件 |`);
  lines.push(`| racer_course_stats 14日超 | ${r.courseStats.over14Days} 件 |`);
  lines.push(`| weekly launchd | ${r.launchd.loaded ? "✅ ロード済み" : "❌ 未ロード"} |`);
  lines.push(`| ログ最終更新 | ${r.log.lastModified ? fmtDate(r.log.lastModified) : "なし"} |`);
  lines.push("");

  lines.push("## F歴判定 (headFlyingCount) の信頼度");
  lines.push("");
  lines.push(
    `> ${reliabilityIcon(r.flyingCountReliability)} **${r.flyingCountReliability}**: ${r.flyingCountReliabilityReason}`
  );
  lines.push("");
  lines.push(
    "> ℹ️ flying_count が NULL の場合、isBase/wind5 条件では `?? 0` で headF=0 扱いになる。"
  );
  lines.push("> NULL選手が 1号艇に入ると headF=0 条件を誤って通過する可能性がある。");
  lines.push("");

  lines.push("## isBase / wind5 対象選手の鮮度");
  lines.push("");
  lines.push(
    "| 対象 | 選手数 | 7日超 | flying_count NULL | profiles未登録 | headF影響可能性 |"
  );
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const detail of [r.recentIsBase, r.recentWind5, r.forwardPeriod]) {
    lines.push(
      `| ${detail.label} | ${detail.totalRacers} | ${detail.stale7} | ${detail.flyingCountNull} | ${detail.notInProfiles} | ${detail.headFImpacted} |`
    );
  }
  lines.push("");
  lines.push(
    "> profiles未登録・flying_count NULL の選手は引退選手または履歴期間前の選手が大半。"
  );
  lines.push("");

  const fm = r.forwardPeriodMeta;
  lines.push("## paper forward期間の実データ範囲");
  lines.push("");
  lines.push(`| 項目 | 値 |`);
  lines.push(`|---|---|`);
  lines.push(`| 基準日 (FORWARD_START) | ${FORWARD_START} |`);
  lines.push(`| 実データ最古 | ${fm.minDate ?? "なし"} |`);
  lines.push(`| 実データ最新 | ${fm.maxDate ?? "なし"} |`);
  lines.push(`| 対象レース数 | ${fm.raceCount} 件 |`);
  lines.push("");

  lines.push("## launchd 週次自動更新");
  lines.push("");
  lines.push(`- **ラベル**: \`${r.launchd.label}\``);
  lines.push(`- **スケジュール**: ${r.launchd.schedule}`);
  lines.push(
    `- **状態**: ${r.launchd.loaded ? "✅ ロード済み (自動更新有効)" : "❌ 未ロード"}`
  );
  lines.push("");

  lines.push("## 直近ログ");
  lines.push("");
  if (r.log.exists) {
    lines.push(`**最終更新**: ${fmtDate(r.log.lastModified)}`);
    lines.push("");
    lines.push("```");
    lines.push(...r.log.lastLines);
    lines.push("```");
  } else {
    lines.push("ログファイルなし");
  }
  lines.push("");

  if (r.log.errExists && r.log.errLastLines.length > 0) {
    lines.push("**エラーログ (直近5行)**:");
    lines.push("");
    lines.push("```");
    lines.push(...r.log.errLastLines);
    lines.push("```");
    lines.push("");
  }

  lines.push("## 判定・推奨アクション");
  lines.push("");
  lines.push(
    `> ${actionIcon(r.recommendedAction)} **${r.recommendedAction}**: ${r.recommendedActionDetail}`
  );
  lines.push("");
  lines.push(
    `- **今すぐ fetch:racer-stats 必要**: ${r.fetchNeededNow ? "⚠️ YES" : "✅ NO"}`
  );
  lines.push(`  - 理由: ${r.fetchNeededReason}`);
  lines.push("");

  return lines.join("\n");
}

const report = run();

const md = generateMarkdown(report);
writeFileSync(REPORT_MD, md, "utf8");
writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(md);
console.log(`\n→ ${REPORT_MD}`);
console.log(`→ ${REPORT_JSON}`);
