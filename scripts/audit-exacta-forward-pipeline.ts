/**
 * 2連単のfuture-only検証経路を読み取り専用で監査する。
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP、app_settings・本番判定の変更。
 * このスクリプトが書くのは reports 配下の監査結果だけ。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const LOCK_PATH = "data/exacta-forward-candidates.json";
const OUT_JSON = "reports/exacta-forward-pipeline-audit.json";
const OUT_MD = "reports/exacta-forward-pipeline-audit.md";
const RECENT_TIMESERIES_ROWS = 5_000;

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);

const autoFetchSource = readFileSync("scripts/auto-fetch-odds.ts", "utf8");
const h011Source = readFileSync("scripts/report-h011-forward-monitor.ts", "utf8");
const exactaMonitorSource = readFileSync("scripts/report-exacta-forward-monitor.ts", "utf8");
const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as {
  lockedAt: string;
  basePopulation: { runKind: string; decision: string; selection: string };
};

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");

try {
  const columns = db.prepare("PRAGMA table_info('odds_timeseries_snapshots')").all() as Array<{ name: string }>;
  const timeseriesColumns = columns.map((row) => row.name);
  const latestTimeseries = db.prepare(`
    SELECT id, race_id, selection, source, checkpoint_label, captured_at
    FROM odds_timeseries_snapshots
    ORDER BY id DESC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;
  const recentTimeseries = db.prepare(`
    WITH recent AS (
      SELECT selection, source
      FROM odds_timeseries_snapshots
      ORDER BY id DESC
      LIMIT ?
    )
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN selection GLOB '[1-6]-[1-6]' THEN 1 ELSE 0 END) AS exacta_shaped,
      SUM(CASE WHEN selection GLOB '[1-6]-[1-6]-[1-6]' THEN 1 ELSE 0 END) AS trifecta_shaped,
      COUNT(DISTINCT source) AS sources
    FROM recent
  `).get(RECENT_TIMESERIES_ROWS) as {
    n: number;
    exacta_shaped: number;
    trifecta_shaped: number;
    sources: number;
  };
  const recentSources = db.prepare(`
    WITH recent AS (
      SELECT source
      FROM odds_timeseries_snapshots
      ORDER BY id DESC
      LIMIT ?
    )
    SELECT source, COUNT(*) AS n
    FROM recent
    GROUP BY source
    ORDER BY n DESC, source
  `).all(RECENT_TIMESERIES_ROWS) as Array<{ source: string; n: number }>;
  const decisions = db.prepare(`
    SELECT run_kind, decision, COUNT(*) AS n, MIN(date) AS min_date, MAX(date) AS max_date
    FROM decision_history
    WHERE date >= ?
    GROUP BY run_kind, decision
    ORDER BY run_kind, decision
  `).all(lock.lockedAt) as Array<{
    run_kind: string;
    decision: string;
    n: number;
    min_date: string;
    max_date: string;
  }>;

  const checks = {
    officialExactaParserReady: existsSync("src/domain/exactaOddsParser.ts"),
    timeseriesHasBetType: timeseriesColumns.includes("bet_type"),
    activeCollectorFetchesExacta: autoFetchSource.includes("parseAllExactaOdds") || autoFetchSource.includes("odds2tf"),
    activeCollectorIsTrifectaOnly: autoFetchSource.includes("parseAllTrifectaOdds") && autoFetchSource.includes("all-120"),
    fixedMonitorUsesLiveTimeseries: exactaMonitorSource.includes("odds_timeseries_snapshots"),
    fixedMonitorUsesHistoricalClosingOdds: exactaMonitorSource.includes("historical_alternative_odds"),
    h011DefaultIsHistoricalBackfill: /H011_RUN_KIND\s*\?\?\s*["']historical-backfill["']/u.test(h011Source),
  };

  const blockers = [
    !checks.timeseriesHasBetType
      ? "odds_timeseries_snapshots に bet_type がなく、2連単と2連複の同形selectionを安全に区別できない"
      : null,
    !checks.activeCollectorFetchesExacta
      ? "稼働中のT-5収集は3連単公式ページだけを取得し、2連単を取得していない"
      : null,
    !checks.fixedMonitorUsesLiveTimeseries
      ? "固定2連単モニターはT-5時系列ではなく historical closing odds を参照している"
      : null,
    checks.h011DefaultIsHistoricalBackfill
      ? "H011モニターの既定run_kindが historical-backfill のため、paper-live判定を監視対象にしない"
      : null,
  ].filter((value): value is string => value != null);

  const report = {
    generatedAt: new Date().toISOString(),
    verdict: blockers.length === 0 ? "ready" : "blocked",
    safety: {
      dbReadOnly: true,
      productionDecisionChanged: false,
      schemaChanged: false,
      collectorActivated: false,
    },
    lock,
    checks,
    blockers,
    evidence: {
      timeseriesColumns,
      latestTimeseries: latestTimeseries ?? null,
      recentTimeseriesWindow: RECENT_TIMESERIES_ROWS,
      recentTimeseries,
      recentSources,
      decisionsSinceLock: decisions,
    },
    remediationOrder: [
      "券種を主キー・一意性・検索条件に含めるbet-type-awareな前向きオッズ保存先を設計する",
      "公式odds2tfの2連単30通りをT-20/T-5等のcheckpointで収集し、2連複を混入させない",
      "固定候補モニターをpaper-live判定と同時点の2連単オッズへ接続する",
      "結果確定後にexacta払戻と結合し、欠測・返還・フライングを別状態として監視する",
      "十分なfuture-only標本が貯まるまでBUY・app_settings・本番decisionへ接続しない",
    ],
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[audit-exacta-forward-pipeline] verdict=${report.verdict} blockers=${blockers.length}`);
  console.log(`[audit-exacta-forward-pipeline] recent exacta-shaped=${recentTimeseries.exacta_shaped}/${recentTimeseries.n}`);
  console.log(`[audit-exacta-forward-pipeline] wrote ${OUT_MD}`);
} finally {
  db.close();
}

function renderMarkdown(report: {
  generatedAt: string;
  verdict: string;
  safety: Record<string, boolean>;
  lock: { lockedAt: string; basePopulation: { runKind: string; decision: string; selection: string } };
  checks: Record<string, boolean>;
  blockers: string[];
  evidence: {
    timeseriesColumns: string[];
    latestTimeseries: Record<string, unknown> | null;
    recentTimeseriesWindow: number;
    recentTimeseries: { n: number; exacta_shaped: number; trifecta_shaped: number; sources: number };
    recentSources: Array<{ source: string; n: number }>;
    decisionsSinceLock: Array<{ run_kind: string; decision: string; n: number; min_date: string; max_date: string }>;
  };
  remediationOrder: string[];
}): string {
  const latest = report.evidence.latestTimeseries;
  return `${[
    "# 2連単 future-only パイプライン監査",
    "",
    `- 生成: ${report.generatedAt}`,
    `- 判定: **${report.verdict.toUpperCase()}**`,
    `- 候補ロック日: ${report.lock.lockedAt}`,
    "- 読み取り専用監査。本番判定・DBスキーマ・収集ジョブは変更していない。",
    "",
    "## 結論",
    "",
    report.blockers.length === 0
      ? "固定した2連単候補をfuture-onlyで検証できる経路が揃っている。"
      : "現在のexacta市場残差・固定候補モニターは、名前に反してfuture-only価格データを自然増加させる経路になっていない。H011の固定1点ROI監視はpaper-liveへ修正済みだが、市場価格を使う候補は収集・保存・監視の接続修正が先。",
    "",
    ...report.blockers.map((blocker) => `- ❌ ${blocker}`),
    "",
    "公式2連単HTMLを2連複と分離して30通り抽出するパーサーと単体テストは追加済み。ただし収集ジョブへの接続とDB書き込みは、この監査では有効化していない。",
    "",
    "## 実データの証拠",
    "",
    `- 直近${report.evidence.recentTimeseriesWindow}行: 3連単形=${report.evidence.recentTimeseries.trifecta_shaped}、2連単形=${report.evidence.recentTimeseries.exacta_shaped}`,
    `- 最新行: ${latest ? `${String(latest.race_id)} / ${String(latest.selection)} / ${String(latest.checkpoint_label)} / ${String(latest.captured_at)}` : "なし"}`,
    `- timeseries列: ${report.evidence.timeseriesColumns.join(", ")}`,
    `- source: ${report.evidence.recentSources.map((row) => `${row.source}=${row.n}`).join(", ") || "なし"}`,
    "",
    "### 候補ロック日以降のdecision_history",
    "",
    "| run_kind | decision | n | min | max |",
    "|---|---:|---:|---:|---:|",
    ...report.evidence.decisionsSinceLock.map((row) => `| ${row.run_kind} | ${row.decision} | ${row.n} | ${row.min_date} | ${row.max_date} |`),
    "",
    "## 修正の順序",
    "",
    ...report.remediationOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 安全境界",
    "",
    "- 2連単パーサー追加まで実施。自動収集・DB migration・本番判断への接続は未実施。",
    "- 現スキーマへselection文字列だけで2連単を混在させない。2連複と衝突し、券種別品質監査ができなくなるため。",
  ].join("\n")}\n`;
}
