/**
 * Phase N0: 全券種データ取得可能性・保存設計監査。
 *
 * DBはreadOnly + query_onlyで開き、外部通信・migration・実収集・モデル処理を行わない。
 * 出力先はreports配下のMarkdown/JSONだけ。
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  ALL_BET_TYPES,
  BET_TYPE_CONTRACTS,
  type AllBetType,
  type FeasibilityDecision,
  buildRequestBudgetScenario,
  officialRaceUrl,
} from "../src/domain/allBetTypeFeasibility";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const REPORT_JSON = "reports/all-bet-type-data-feasibility.json";
const REPORT_MD = "reports/all-bet-type-data-feasibility.md";
const AUDITED_RACE = { date: "2026-07-21", venueCode: "23", raceNo: 1 };
const AUDIT_DATE_JST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);

const dbStatBefore = statSync(DB_PATH);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000; PRAGMA temp_store=MEMORY;");
const totalChangesBefore = scalar("SELECT total_changes()");

try {
  const schema = inventorySchema();
  const payoutCoverage = rows(`
    SELECT bet_type AS betType, COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races,
      MIN(date) AS minDate, MAX(date) AS maxDate,
      SUM(CASE WHEN returned=1 THEN 1 ELSE 0 END) AS returnedRows,
      COUNT(DISTINCT combination) AS distinctCombinations
    FROM race_payouts GROUP BY bet_type ORDER BY bet_type
  `);
  const closingOddsCoverage = rows(`
    SELECT bet_type AS betType, source_type AS sourceType, source_quality AS sourceQuality,
      COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races,
      MIN(race_date) AS minDate, MAX(race_date) AS maxDate
    FROM historical_alternative_odds
    GROUP BY bet_type, source_type, source_quality ORDER BY bet_type, source_type
  `);
  const payoutStructureAnomalies = {
    multiLineRaces: rows(`
      SELECT bet_type AS betType, COUNT(*) AS races, MAX(line_count) AS maxLines
      FROM (
        SELECT bet_type, race_id, COUNT(*) AS line_count
        FROM race_payouts
        GROUP BY bet_type, race_id
        HAVING COUNT(*) > 1
      )
      GROUP BY bet_type ORDER BY bet_type
    `),
    zeroBoatSelections: rows(`
      SELECT bet_type AS betType, combination, COUNT(*) AS rows
      FROM race_payouts
      WHERE combination IS NULL OR combination='' OR combination LIKE '0%' OR combination LIKE '%-0%'
      GROUP BY bet_type, combination ORDER BY bet_type, combination
    `),
  };
  const checkpointCoverage = rows(`
    SELECT checkpoint_label AS checkpoint, COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races,
      MIN(minutes_before_close) AS minMinutesBeforeClose,
      MAX(minutes_before_close) AS maxMinutesBeforeClose,
      MIN(captured_at) AS minCapturedAt, MAX(captured_at) AS maxCapturedAt
    FROM odds_timeseries_snapshots
    GROUP BY checkpoint_label ORDER BY checkpoint_label
  `);
  const sourceCoverage = {
    preRaceWeather: tableCoverage("race_weather", "fetched_at"),
    postRaceConditions: tableCoverage("race_conditions", "fetched_at"),
    exhibition: tableCoverage("exhibition_data", "fetched_at"),
    equipment: tableCoverage("race_equipment", "fetched_at"),
    actualEntries: tableCoverage("race_entries", "fetched_at"),
    programs: tableCoverage("official_programs", "imported_at"),
    results: tableCoverage("race_results", "fetched_at"),
  };
  const prePostOverlap = rows(`
    SELECT
      (SELECT COUNT(DISTINCT race_id) FROM race_weather) AS preRaceWeatherRaces,
      (SELECT COUNT(DISTINCT race_id) FROM race_conditions) AS postRaceConditionRaces,
      (SELECT COUNT(DISTINCT w.race_id) FROM race_weather w INNER JOIN race_conditions c USING(race_id)) AS overlapRaces,
      (SELECT COUNT(DISTINCT race_id) FROM exhibition_data) AS exhibitionRaces,
      (SELECT COUNT(DISTINCT race_id) FROM race_entries WHERE entry_course IS NOT NULL) AS actualCourseRaces,
      (SELECT COUNT(DISTINCT race_id) FROM race_entries WHERE st IS NOT NULL) AS actualStartTimingRaces,
      (SELECT COUNT(DISTINCT race_id) FROM race_entries WHERE status_code IS NOT NULL) AS incidentStatusRaces
  `)[0];

  const payoutByBetType = new Map(payoutCoverage.map((row) => [String(row.betType), row]));
  const closingByBetType = new Map(closingOddsCoverage.map((row) => [String(row.betType), row]));
  const betTypes = BET_TYPE_CONTRACTS.map((contract) => {
    const payout = payoutByBetType.get(contract.betType);
    const closing = closingByBetType.get(contract.betType);
    const payoutDecision: FeasibilityDecision =
      payout ? "GO" : contract.betType === "win" || contract.betType === "place" ? "CONDITIONAL" : "UNKNOWN";
    const liveOddsDecision: FeasibilityDecision = contract.betType === "trifecta" ? "GO" : "CONDITIONAL";
    const historicalOddsDecision: FeasibilityDecision = closing
      ? "GO"
      : contract.betType === "exacta" || contract.betType === "trifecta" ? "CONDITIONAL" : "UNKNOWN";
    return {
      ...contract,
      payout: {
        decision: payoutDecision,
        rows: Number(payout?.rows ?? 0),
        races: Number(payout?.races ?? 0),
        minDate: payout?.minDate ?? null,
        maxDate: payout?.maxDate ?? null,
        note: payout
          ? "現DBに公式日次成績由来の実払戻あり。複数行・返還の意味をN1でfixture固定する。"
          : "公式結果ページ・日次成績には存在するが、現行detail parserとDB投入経路が未対応。",
      },
      liveOdds: {
        decision: liveOddsDecision,
        rows: contract.betType === "trifecta" ? Number(scalar("SELECT COUNT(*) FROM odds_timeseries_snapshots")) : 0,
        note: contract.betType === "trifecta"
          ? "現行時系列はbet_type列なしの3連単専用。T-30/T-20/T-10/T-5を保持。"
          : "公式公開画面は確認済み。bet_type、range odds、欠場・発売なし状態を含む保存契約が未実装。",
      },
      historicalOdds: {
        decision: historicalOddsDecision,
        rows: Number(closing?.rows ?? 0),
        races: Number(closing?.races ?? 0),
        minDate: closing?.minDate ?? null,
        maxDate: closing?.maxDate ?? null,
        note: closing
          ? "historical closing。T-5や最終確定オッズとは呼ばない。"
          : "現DBに履歴なし。公式画面の保持期間・再現性・許容負荷はN1/N2前canaryで要確認。",
      },
      roiReady: Boolean(payout && (contract.betType === "trifecta" || closing)),
      clvReady: contract.betType === "trifecta",
    };
  });

  const requestBudgets = [
    buildRequestBudgetScenario({
      name: "result-only",
      racesPerDay: 144,
      checkpointsPerRace: 0,
      pagesPerCheckpoint: 0,
      resultPagesPerRace: 1,
    }),
    buildRequestBudgetScenario({
      name: "all-markets-T-5-only",
      racesPerDay: 144,
      checkpointsPerRace: 1,
      pagesPerCheckpoint: 5,
      resultPagesPerRace: 1,
    }),
    buildRequestBudgetScenario({
      name: "all-markets-4-checkpoints",
      racesPerDay: 144,
      checkpointsPerRace: 4,
      pagesPerCheckpoint: 5,
      resultPagesPerRace: 1,
    }),
  ];

  const report = {
    phase: "N0",
    generatedAt: new Date().toISOString(),
    auditDateJst: AUDIT_DATE_JST,
    scope: {
      included: ["read-only DB/schema/coverage audit", "one-race official source structure check", "storage and migration design"],
      excluded: ["DB migration", "data collection", "prediction/model changes", "market residual model", "ticket selector", "production connection"],
    },
    safety: {
      dbPath: DB_PATH,
      readOnly: true,
      queryOnly: true,
      externalRequestsByThisCli: 0,
      dbTotalChangesBefore: totalChangesBefore,
      dbTotalChangesAfter: scalar("SELECT total_changes()"),
      databaseBytesBefore: dbStatBefore.size,
      databaseMtimeBefore: dbStatBefore.mtime.toISOString(),
    },
    officialEvidence: {
      auditedRace: AUDITED_RACE,
      beforeInfoUrl: officialRaceUrl("beforeinfo", AUDITED_RACE),
      resultUrl: officialRaceUrl("raceresult", AUDITED_RACE),
      oddsUrls: [...new Set(BET_TYPE_CONTRACTS.map((row) => officialRaceUrl(row.officialOddsPath, AUDITED_RACE)))],
      robotsUrl: "https://www.boatrace.jp/robots.txt",
      sitePolicyUrl: "https://www.boatrace.jp/owpc/pc/extra/policy.html",
      aboutUrl: "https://www.boatrace.jp/owpc/pc/extra/about.html",
      archiveEvidence: "data/raw/official/results/k260721.lzh のK260721.TXTに7券種の払戻行を確認（リポジトリ内既存cache、抽出物は未保存）。",
    },
    schema,
    payoutCoverage,
    payoutStructureAnomalies,
    closingOddsCoverage,
    checkpointCoverage,
    sourceCoverage,
    prePostOverlap,
    betTypes,
    requestBudgets,
    acquisitionDecision: {
      payout: "CONDITIONAL",
      liveOdds: "CONDITIONAL",
      historicalOdds: "CONDITIONAL",
      weatherAndExhibition: "CONDITIONAL",
      salesAndLiquidity: "BLOCKED",
      rationale: [
        "払戻は7券種とも公式結果/日次成績に存在するが、win/place parser、同着・返還・不成立契約が未固定。",
        "全券種オッズは5画面で公開されるが、全race×4 checkpointは3,024 request/day想定で、サイトポリシーの大量アクセス禁止に照らし現状のままGOにできない。",
        "売上額・投票口数の公式公開ソースを今回の最小確認では特定できず、オッズ変化は流動性そのものではない。",
      ],
    },
    phaseN1EntryGate: [
      "N0設計レビュー承認",
      "7券種払戻fixtureで通常・複数的中/同着・返還・不成立・特払いを固定",
      "read-only dry-runでparser coverageとidempotency keyを確認",
      "公式サイト方針に適合する低頻度canaryの人間承認",
      "migrationを別タスクとしてレビューし、backup/rollback手順を確定",
    ],
  };

  const dbStatAfter = statSync(DB_PATH);
  Object.assign(report.safety, {
    databaseBytesAfter: dbStatAfter.size,
    databaseMtimeAfter: dbStatAfter.mtime.toISOString(),
    databaseFileChangedDuringAudit: dbStatAfter.size !== dbStatBefore.size || dbStatAfter.mtimeMs !== dbStatBefore.mtimeMs,
    note: "total_changes()=0が本CLIの非書き込み証拠。file変化がtrueの場合は並行collector等の外部processによる可能性を分離する。",
  });

  mkdirSync("reports", { recursive: true });
  writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(REPORT_MD, renderMarkdown(report));
  console.log(`Phase N0 audit complete: ${REPORT_MD}, ${REPORT_JSON}`);
  console.log(`DB total_changes=${report.safety.dbTotalChangesAfter}; external requests=0`);
} finally {
  db.close();
}

function inventorySchema() {
  const tables = rows("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return tables.map((table) => {
    const name = String(table.name);
    const columns = rows(`PRAGMA table_info(${quoteIdentifier(name)})`);
    const indexes = rows(`PRAGMA index_list(${quoteIdentifier(name)})`).map((index) => ({
      ...index,
      columns: rows(`PRAGMA index_info(${quoteIdentifier(String(index.name))})`),
    }));
    const dateColumn = ["date", "race_date", "captured_at", "fetched_at", "created_at"].find((candidate) =>
      columns.some((column) => column.name === candidate));
    const hasRaceId = columns.some((column) => column.name === "race_id");
    const sourceColumns = columns.map((column) => String(column.name)).filter((name) =>
      ["source", "source_file", "source_type", "source_quality", "source_url", "parser_version", "fetch_status", "fetched_at", "imported_at", "captured_at"].includes(name));
    return {
      name,
      sql: table.sql,
      rowCount: Number(scalar(`SELECT COUNT(*) FROM ${quoteIdentifier(name)}`)),
      distinctRaces: hasRaceId ? Number(scalar(`SELECT COUNT(DISTINCT race_id) FROM ${quoteIdentifier(name)}`)) : null,
      range: dateColumn ? rows(`SELECT MIN(${quoteIdentifier(dateColumn)}) AS min, MAX(${quoteIdentifier(dateColumn)}) AS max FROM ${quoteIdentifier(name)}`)[0] : null,
      sourceColumns,
      columns,
      indexes,
    };
  });
}

function tableCoverage(table: string, timestampColumn: string) {
  return rows(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races,
      MIN(${quoteIdentifier(timestampColumn)}) AS minTimestamp,
      MAX(${quoteIdentifier(timestampColumn)}) AS maxTimestamp
    FROM ${quoteIdentifier(table)}
  `)[0];
}

function rows(sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

function scalar(sql: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown>;
  return Number(Object.values(row)[0] ?? 0);
}

function quoteIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function renderMarkdown(report: any): string {
  const line = (value: unknown) => value == null ? "—" : String(value);
  const integer = (value: unknown) => Number(value).toLocaleString("ja-JP");
  const decision = (value: string) => `**${value}**`;
  const lines = [
    "# 全券種データ取得可能性・保存設計監査（Phase N0）",
    "",
    `生成日時: ${report.generatedAt}`,
    "",
    "> 読み取り専用監査。DB migration、実収集、予測ロジック、市場残差モデル、券種選択器、production接続は実施していない。",
    "",
    "## 結論",
    "",
    "- 7券種の公式払戻は、同一レースの公式結果ページと既存公式日次成績cacheで確認できた。",
    "- 現DBの払戻はexacta / quinella / wide / trifecta / trioのみ。win / placeは公式ソースにあるが現行parserが保存していない。",
    "- 全券種オッズは5つの公式画面に分かれる。現DBのlive timeseriesはbet_type列のない3連単専用で、他券種を安全に混在できない。",
    "- range表示のplace / wide、同着・返還・不成立・特払い、欠場を明示的な状態として保存する必要がある。",
    "- 全race×5画面×4 checkpointは負荷が大きい。サイトポリシーは大量アクセスを禁止しているため、低頻度canaryと運用承認なしに実収集へ進めない。",
    "- 売上・投票口数の取得根拠は未確認。オッズ変化を流動性そのものと呼ばない。",
    "",
    "## 7券種判定",
    "",
    "| 券種 | 6艇買い目 | 表示 | 払戻 | live時系列 | historical odds | ROI | CLV |",
    "|---|---:|---|---|---|---|---|---|",
    ...report.betTypes.map((row: any) =>
      `| ${row.japaneseName} (${row.betType}) | ${row.expectedSelectionsForSixBoats} | ${row.oddsValueKind} | ${decision(row.payout.decision)} ${integer(row.payout.races)} races | ${decision(row.liveOdds.decision)} | ${decision(row.historicalOdds.decision)} | ${row.roiReady ? "条件付き可" : "不可"} | ${row.clvReady ? "3連単のみ可" : "不可"} |`),
    "",
    "判定語:",
    "",
    "- GO: 現DBと既存経路で用途に必要な契約がある。",
    "- CONDITIONAL: 公式構造は確認できたが、parser/schema/rate-limit/canaryのいずれかが未完。",
    "- BLOCKED: 必須ソースまたは安全条件がない。",
    "- UNKNOWN: 最小監査では根拠不足。",
    "",
    "## 現DB実測",
    "",
    `- DB: \`${report.safety.dbPath}\``,
    `- table数: ${report.schema.length}`,
    `- odds_timeseries_snapshots: ${integer(report.schema.find((row: any) => row.name === "odds_timeseries_snapshots")?.rowCount)} rows`,
    `- DB total_changes: before=${report.safety.dbTotalChangesBefore}, after=${report.safety.dbTotalChangesAfter}`,
    `- 監査CLIの外部request: ${report.safety.externalRequestsByThisCli}`,
    `- 監査中DB file変化: ${report.safety.databaseFileChangedDuringAudit ? "あり（並行collector等の外部processと分離）" : "なし"}`,
    "",
    "### 払戻coverage",
    "",
    "| bet_type | rows | races | date range | returned rows |",
    "|---|---:|---:|---|---:|",
    ...report.payoutCoverage.map((row: any) =>
      `| ${row.betType} | ${integer(row.rows)} | ${integer(row.races)} | ${line(row.minDate)} .. ${line(row.maxDate)} | ${integer(row.returnedRows)} |`),
    "| win | 0 | 0 | — | 0 |",
    "| place | 0 | 0 | — | 0 |",
    "",
    "### historical closing odds",
    "",
    "| bet_type | source | quality | rows | races | date range |",
    "|---|---|---|---:|---:|---|",
    ...report.closingOddsCoverage.map((row: any) =>
      `| ${row.betType} | ${row.sourceType} | ${row.sourceQuality} | ${integer(row.rows)} | ${integer(row.races)} | ${line(row.minDate)} .. ${line(row.maxDate)} |`),
    "",
    "### 払戻構造anomaly",
    "",
    "| bet_type | 複数line race | 最大line数 |",
    "|---|---:|---:|",
    ...report.payoutStructureAnomalies.multiLineRaces.map((row: any) =>
      `| ${row.betType} | ${integer(row.races)} | ${integer(row.maxLines)} |`),
    "",
    ...report.payoutStructureAnomalies.zeroBoatSelections.map((row: any) =>
      `- canonical範囲外: ${row.betType} \`${line(row.combination)}\` = ${integer(row.rows)} row`),
    "",
    "複数lineは実在し、2007-10-19下関6Rでは各券種に2つの的中組がある。これは同着等の結果構造を単一rowへ潰せない証拠である。`wide=0-0`も1件あり、過去の特払い等を推測で通常selectionへ変換せずN1 fixtureで意味を固定する。",
    "",
    "### 3連単時系列checkpoint",
    "",
    "| checkpoint | rows | races | minutes_before_close range | captured range |",
    "|---|---:|---:|---|---|",
    ...report.checkpointCoverage.map((row: any) =>
      `| ${line(row.checkpoint)} | ${integer(row.rows)} | ${integer(row.races)} | ${line(row.minMinutesBeforeClose)} .. ${line(row.maxMinutesBeforeClose)} | ${line(row.minCapturedAt)} .. ${line(row.maxCapturedAt)} |`),
    "",
    "> rowsには修正前の重複保存を含む。race数は存在coverageであり、単一captured_atの完全市場数ではない。完全性は既存 `audit:t5-market-coverage` / `audit:t5-collector-efficiency` を正本にする。",
    "",
    "## point-in-time境界",
    "",
    "| データ | 事前利用 | 現状 | 設計判断 |",
    "|---|---|---|---|",
    "| official_programs | 可 | 日付・締切・選手/機材の番組snapshot。現状はimported_at | 将来はsource timestampとobserved_atを分離 |",
    "| race_weather | 可 | beforeinfo由来。風速等あり、風向列なし | observed_atとsource page timestampを分離し、風向を追加 |",
    "| exhibition_data / race_equipment | 可 | 最新値upsert。courseキー | frame/boat/exhibition_courseを分離しappend-only snapshot化 |",
    "| race_conditions | 不可 | 結果archive由来の天候・風向・決まり手 | post-race label専用。事前特徴へ混入禁止 |",
    "| race_entries.entry_course / st / finish_pos | 不可 | 実進入・実ST・結果/事故 | 結果原因ラベル専用 |",
    "| race_payouts | 不可 | 確定後払戻 | ROI settlement専用。オッズ代替禁止 |",
    "",
    "## 展示・結果原因・事故",
    "",
    `- pre-race weather races: ${integer(report.prePostOverlap.preRaceWeatherRaces)}`,
    `- post-race condition races: ${integer(report.prePostOverlap.postRaceConditionRaces)}`,
    `- 両方があるraces: ${integer(report.prePostOverlap.overlapRaces)}`,
    `- exhibition races: ${integer(report.prePostOverlap.exhibitionRaces)}`,
    `- actual course races: ${integer(report.prePostOverlap.actualCourseRaces)}`,
    `- actual ST races: ${integer(report.prePostOverlap.actualStartTimingRaces)}`,
    `- status_code races: ${integer(report.prePostOverlap.incidentStatusRaces)}`,
    "",
    "現行beforeinfo parserは展示タイム、展示ST、チルト、プロペラ、部品交換、天候、風速、波高、気温、水温、安定板、周回短縮を扱う。公式画面の風向は画像で、現行parser/`race_weather`に保存されない。展示進入は`course`に畳み込まれており、枠・艇・展示コースの区別が弱い。結果archiveには実進入、実ST、着順、事故status、決まり手、結果時の風向があるが、事前特徴ではない。",
    "",
    "## 売上・流動性",
    "",
    "- 判定: **BLOCKED**",
    "- 今回確認した公式race画面・日次成績archiveには券種別売上額/投票口数を確認できなかった。",
    "- オッズ水準、overround、更新間の変化量、レンジ幅は市場状態proxy候補だが、売上・流動性の実測値とは呼ばない。",
    "- proxyを使う場合も `metric_kind=proxy`、算出version、観測時刻、欠測理由を保存し、因果説明へ使わない。",
    "",
    "## request budget",
    "",
    "| scenario | races/day | checkpoints | pages/checkpoint | results/race | requests/day | 全日平均間隔 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...report.requestBudgets.map((row: any) =>
      `| ${row.name} | ${row.racesPerDay} | ${row.checkpointsPerRace} | ${row.pagesPerCheckpoint} | ${row.resultPagesPerRace} | ${integer(row.requestsPerDay)} | ${row.minimumAverageIntervalSeconds.toFixed(1)}秒 |`),
    "",
    "144 races/dayは安全側の設計例であり、開催数実測ではない。robots.txtは全面許可形式だが、サイトポリシーは大量アクセスを禁止する。robots許可を収集許可と同一視しない。N2ではrace単位の締切窓、ETag/Last-Modifiedの有無、同一checkpoint skip、global concurrency、host間隔、指数backoff、日次上限、kill switchを先に固定する。",
    "",
    "## 公式根拠と制約",
    "",
    `- 直前情報: ${report.officialEvidence.beforeInfoUrl}`,
    `- 結果（7券種払戻）: ${report.officialEvidence.resultUrl}`,
    `- オッズ5画面: ${report.officialEvidence.oddsUrls.join(" / ")}`,
    `- robots.txt: ${report.officialEvidence.robotsUrl}`,
    `- サイトポリシー: ${report.officialEvidence.sitePolicyUrl}`,
    `- 更新仕様: ${report.officialEvidence.aboutUrl}`,
    `- archive: ${report.officialEvidence.archiveEvidence}`,
    "",
    "公式仕様上、オッズ画面の更新は自動ではなく、締切時オッズも最終確定オッズではない。スタート事故等を反映したオッズも表示されない。したがって `observed odds`、`closing-like odds`、`official payout` を別のsource qualityで保存する。",
    "",
    "## N1へ進める条件",
    "",
    ...report.phaseN1EntryGate.map((gate: string) => `- [ ] ${gate}`),
    "",
    "Phase N0の判定は、払戻基盤を最初の独立実装候補とすること。オッズ時系列、モデル、券種選択器はN1に含めない。",
    "",
    "## table inventory",
    "",
    "| table | rows | races | range | source/provenance columns |",
    "|---|---:|---:|---|---|",
    ...report.schema.map((table: any) =>
      `| ${table.name} | ${integer(table.rowCount)} | ${table.distinctRaces == null ? "—" : integer(table.distinctRaces)} | ${table.range ? `${line(table.range.min)} .. ${line(table.range.max)}` : "—"} | ${table.sourceColumns.join(", ") || "—"} |`),
    "",
    `詳細な全column/index/CREATE SQLは \`${REPORT_JSON}\` の \`schema\` を参照。`,
  ];
  return `${lines.join("\n")}\n`;
}
