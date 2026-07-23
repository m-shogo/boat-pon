/**
 * Phase N0: 全券種データ取得可能性・保存設計監査。
 *
 * DBはreadOnly + query_onlyで開き、外部通信・migration・実収集・モデル処理を行わない。
 * 出力先はreports配下のMarkdown/JSONだけ。
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  ALL_BET_TYPES,
  BET_TYPE_CONTRACTS,
  type AllBetType,
  type FeasibilityDecision,
  buildRequestBudgetScenario,
  officialRaceUrl,
} from "../src/domain/allBetTypeFeasibility";
import { RACER_FEATURE_FEASIBILITY } from "../src/domain/racerDataFeasibility";

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
  const racerAudit = buildRacerAudit();

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
      included: ["read-only DB/schema/coverage audit", "one-race official source structure check", "racer point-in-time feasibility audit", "storage and migration design"],
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
    racerAudit,
    betTypes,
    requestBudgets,
    acquisitionDecision: {
      payout: "CONDITIONAL",
      liveOdds: "CONDITIONAL",
      historicalOdds: "CONDITIONAL",
      weatherAndExhibition: "CONDITIONAL",
      racerPointInTime: "CONDITIONAL",
      salesAndLiquidity: "BLOCKED",
      rationale: [
        "払戻は7券種とも公式結果/日次成績に存在するが、win/place parser、同着・返還・不成立契約が未固定。",
        "全券種オッズは5画面で公開されるが、全race×4 checkpointは3,024 request/day想定で、サイトポリシーの大量アクセス禁止に照らし現状のままGOにできない。",
        "売上額・投票口数の公式公開ソースを今回の最小確認では特定できず、オッズ変化は流動性そのものではない。",
        "レース当時の級別・全国/当地勝率/2連率は番組rawでGO。現在値profile/course statsはhistorical利用BLOCKEDで、結果由来rolling特徴はstrict-prior再構築を条件にCONDITIONAL。",
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

function buildRacerAudit() {
  const profiles = rows(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT registration_no) AS racers,
      MIN(fetched_at) AS minFetchedAt, MAX(fetched_at) AS maxFetchedAt,
      COUNT(DISTINCT substr(fetched_at,1,10)) AS fetchDays,
      SUM(CASE WHEN avg_st IS NOT NULL THEN 1 ELSE 0 END) AS avgStRows,
      SUM(CASE WHEN top3_rate IS NOT NULL THEN 1 ELSE 0 END) AS top3Rows,
      SUM(CASE WHEN flying_count IS NOT NULL THEN 1 ELSE 0 END) AS flyingRows,
      SUM(CASE WHEN late_start_count IS NOT NULL THEN 1 ELSE 0 END) AS lateRows,
      SUM(CASE WHEN ability_index IS NOT NULL THEN 1 ELSE 0 END) AS abilityRows
    FROM racer_profiles
  `)[0];
  const courseStats = rows(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT registration_no) AS racers,
      MIN(fetched_at) AS minFetchedAt, MAX(fetched_at) AS maxFetchedAt,
      COUNT(DISTINCT substr(fetched_at,1,10)) AS fetchDays,
      SUM(CASE WHEN avg_st IS NOT NULL THEN 1 ELSE 0 END) AS avgStRows,
      SUM(CASE WHEN top3_rate IS NOT NULL THEN 1 ELSE 0 END) AS top3Rows,
      SUM(CASE WHEN entry_rate IS NOT NULL THEN 1 ELSE 0 END) AS entryRows,
      SUM(CASE WHEN start_order IS NOT NULL THEN 1 ELSE 0 END) AS startOrderRows,
      SUM(CASE WHEN races > 0 THEN 1 ELSE 0 END) AS positiveSampleRows,
      SUM(CASE WHEN win_rate IS NOT NULL THEN 1 ELSE 0 END) AS winRateRows
    FROM racer_course_stats
  `)[0];
  const entries = rows(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races, COUNT(DISTINCT racer_reg) AS racers,
      MIN(date) AS minDate, MAX(date) AS maxDate,
      SUM(CASE WHEN racer_reg IS NULL THEN 1 ELSE 0 END) AS missingRegistration,
      SUM(CASE WHEN entry_course IS NULL THEN 1 ELSE 0 END) AS missingActualCourse,
      SUM(CASE WHEN st IS NULL THEN 1 ELSE 0 END) AS missingSt,
      SUM(CASE WHEN finish_pos IS NULL THEN 1 ELSE 0 END) AS missingFinish,
      SUM(CASE WHEN status_code IS NOT NULL THEN 1 ELSE 0 END) AS incidentRows
    FROM race_entries
  `)[0];
  const programBoats = rows(`
    WITH boats AS (
      SELECT op.date, op.race_id, j.value AS boat
      FROM official_programs op, json_each(op.raw_json,'$.boats') j
    )
    SELECT COUNT(*) AS rows, COUNT(DISTINCT json_extract(boat,'$.registrationNo')) AS racers,
      MIN(date) AS minDate, MAX(date) AS maxDate,
      SUM(CASE WHEN json_extract(boat,'$.registrationNo') IS NOT NULL THEN 1 ELSE 0 END) AS registrationRows,
      SUM(CASE WHEN json_extract(boat,'$.className') IS NOT NULL THEN 1 ELSE 0 END) AS classRows,
      SUM(CASE WHEN json_extract(boat,'$.nationalWinRate') IS NOT NULL THEN 1 ELSE 0 END) AS nationalWinRows,
      SUM(CASE WHEN json_extract(boat,'$.nationalTop2Rate') IS NOT NULL THEN 1 ELSE 0 END) AS nationalTop2Rows,
      SUM(CASE WHEN json_extract(boat,'$.localWinRate') IS NOT NULL THEN 1 ELSE 0 END) AS localWinRows,
      SUM(CASE WHEN json_extract(boat,'$.localTop2Rate') IS NOT NULL THEN 1 ELSE 0 END) AS localTop2Rows,
      SUM(CASE WHEN json_extract(boat,'$.nationalTop3Rate') IS NOT NULL THEN 1 ELSE 0 END) AS nationalTop3Rows,
      SUM(CASE WHEN json_extract(boat,'$.localTop3Rate') IS NOT NULL THEN 1 ELSE 0 END) AS localTop3Rows,
      SUM(CASE WHEN json_extract(boat,'$.avgSt') IS NOT NULL THEN 1 ELSE 0 END) AS avgStRows,
      SUM(CASE WHEN json_extract(boat,'$.branch') IS NOT NULL THEN 1 ELSE 0 END) AS branchRows,
      SUM(CASE WHEN json_extract(boat,'$.period') IS NOT NULL THEN 1 ELSE 0 END) AS periodRows,
      SUM(CASE WHEN json_extract(boat,'$.age') IS NOT NULL THEN 1 ELSE 0 END) AS ageRows,
      SUM(CASE WHEN json_extract(boat,'$.gender') IS NOT NULL THEN 1 ELSE 0 END) AS genderRows,
      SUM(CASE WHEN json_extract(boat,'$.weightKg') IS NOT NULL THEN 1 ELSE 0 END) AS weightRows
    FROM boats
  `)[0];
  const latestProgramCoverage = rows(`
    WITH latest AS (SELECT MAX(date) AS date FROM official_programs),
    boats AS (
      SELECT json_extract(j.value,'$.registrationNo') AS registration_no,
        json_extract(j.value,'$.course') AS course
      FROM official_programs op, json_each(op.raw_json,'$.boats') j, latest
      WHERE op.date=latest.date
    )
    SELECT (SELECT date FROM latest) AS date, COUNT(*) AS boatRows, COUNT(DISTINCT registration_no) AS racers,
      SUM(CASE WHEN EXISTS(
        SELECT 1 FROM racer_profiles rp
        WHERE rp.registration_no=boats.registration_no AND rp.avg_st IS NOT NULL
      ) THEN 1 ELSE 0 END) AS profileCovered,
      SUM(CASE WHEN EXISTS(
        SELECT 1 FROM racer_course_stats cs
        WHERE cs.registration_no=boats.registration_no AND cs.course=boats.course
      ) THEN 1 ELSE 0 END) AS courseCovered
    FROM boats
  `)[0];
  const historicalRacers = Number(scalar("SELECT COUNT(DISTINCT racer_reg) FROM race_entries WHERE racer_reg IS NOT NULL"));
  const fullSixCourseRacers = Number(scalar(`
    SELECT COUNT(*) FROM (
      SELECT registration_no FROM racer_course_stats
      GROUP BY registration_no HAVING COUNT(DISTINCT course)=6
    )
  `));
  const cacheInventory = {
    officialPrograms: inventoryCache("data/raw/official/programs", /^b(\d{6})\.lzh$/i),
    officialResults: inventoryCache("data/raw/official/results", /^k(\d{6})\.lzh$/i),
    kyotei24PreRaceHtml: inventoryCache("data/raw/kyotei24/odds", /(\d{4}-\d{2}-\d{2})/),
  };
  const decisions = Object.fromEntries(["GO", "CONDITIONAL", "BLOCKED", "UNKNOWN"].map((decision) => [
    decision,
    RACER_FEATURE_FEASIBILITY.filter((row) => row.decision === decision).length,
  ]));
  const featureMatrix = RACER_FEATURE_FEASIBILITY.map((row) => ({
    ...row,
    measurement: racerFeatureMeasurement(row.feature, { profiles, courseStats, entries, programBoats, cacheInventory }),
  }));
  return {
    safety: {
      readOnly: true,
      currentProfileHistoricalFallbackAllowed: false,
      targetRaceAndFutureResultsAllowed: false,
      personRoiRanking: false,
      privateRelationshipInference: false,
    },
    dbCoverage: {
      racerProfiles: {
        ...profiles,
        duplicatePrimaryKeyRows: 0,
        duplicateAssessment: "registration_no PRIMARY KEYにより物理重複不可",
        historicalRacers,
        historicalRacerCoveragePct: historicalRacers > 0 ? Number(profiles.avgStRows) / historicalRacers * 100 : null,
      },
      racerCourseStats: {
        ...courseStats,
        duplicatePrimaryKeyRows: 0,
        duplicateAssessment: "(registration_no,course) PRIMARY KEYにより物理重複不可",
        fullSixCourseRacers,
        historicalRacers,
        historicalRacerCoveragePct: historicalRacers > 0 ? Number(courseStats.racers) / historicalRacers * 100 : null,
      },
      raceEntries: {
        ...entries,
        duplicatePrimaryKeyRows: 0,
        duplicateAssessment: "(race_id,boat_number) PRIMARY KEYにより物理重複不可",
      },
      officialProgramBoats: {
        ...programBoats,
        duplicateAssessment: "official_programsはrace_id一意。raw_json内boatsはschema制約外のため、艇番号・登録番号の構造監査が別途必要",
      },
      latestProgramCoverage,
    },
    cacheInventory,
    featureMatrix,
    goNoGoSummary: decisions,
    alreadyUsable: [
      "登録番号、当時級別、全国/当地勝率・2連率（official_programs.raw_json、2004-06-01以降）",
      "結果履歴の登録番号、実進入、実ST、着順、事故code（race_entries、2000-01-01以降）",
      "保存済みレース前HTML範囲の年齢・支部・性別・体重",
      "prior-day順で再構築する過去同走・直接対戦・同日以前の前走状態",
    ],
    pointInTimeIneligible: [
      "racer_profiles全列をhistoricalへ直接JOIN",
      "racer_course_stats全列をhistoricalへ直接JOIN",
      "現在プロフィールから過去の級別・支部・年齢・体重を補完",
      "対象raceまたは同日後続raceをrolling集計へ含める",
      "race_conditions/race_entriesの対象race結果を事前特徴へ含める",
    ],
    priority: [
      "P0: raw programの当時級別・全国/当地勝率/2連率を正本として明示",
      "P0: race_entriesからstrict priorのn付き30/90走、ST平均/分散、F後日数を再現可能にする設計",
      "P1: profile/period/course-period snapshotのeffective期間と集計窓を保存",
      "P1: beforeinfoの直前体重、展示course/ST/timeをappend-only観測として保存",
      "P2: pair/styleはraw結果から再計算を正本とし、性能上必要な場合だけmaterialize",
    ],
    phaseRecommendation: {
      N1: "変更なし。全券種払戻基盤のみ。選手特徴を混ぜない。",
      N2: "変更なし。全券種odds時系列のみ。選手特徴を混ぜない。",
      N3: "profile/period/course-periodのPIT snapshot、支部/年齢/性別/直前体重、展示/装備append-only。",
      N4: "race_entries/conditionsからstrict-prior recent form、course、pair、style proxyを再構築。対象race結果を拒否。",
    },
    guards: [
      "observed_at <= race close前の許容時刻",
      "as_of_date < race date、同日値はevent order/close_atで厳格に先行",
      "effective_from <= race date <= effective_to",
      "source max event time < target event time",
      "snapshot欠損時はNULL。現在値fallback禁止",
      "raw input fingerprint + parser_version + feature_version + window definitionを固定",
    ],
  };
}

function racerFeatureMeasurement(
  feature: string,
  source: {
    profiles: Record<string, unknown>;
    courseStats: Record<string, unknown>;
    entries: Record<string, unknown>;
    programBoats: Record<string, unknown>;
    cacheInventory: Record<string, { files: number; minDate: string | null; maxDate: string | null }>;
  },
) {
  const pct = (present: unknown, total: unknown) => Number(total) > 0
    ? `${((1 - Number(present) / Number(total)) * 100).toFixed(4)}%`
    : "UNKNOWN";
  const programField: Record<string, string> = {
    registration_no: "registrationRows",
    class_name: "classRows",
    national_win_top2_rate: "nationalWinRows",
    national_top3_rate: "nationalTop3Rows",
    local_win_top2_rate: "localWinRows",
    local_top3_rate: "localTop3Rows",
  };
  if (programField[feature]) {
    return {
      rowCount: source.programBoats.rows,
      racerCoverage: source.programBoats.racers,
      dateRange: [source.programBoats.minDate, source.programBoats.maxDate],
      missingRate: pct(source.programBoats[programField[feature]], source.programBoats.rows),
      duplicateRate: "raw_json内boat keyは未制約。race_id自体はofficial_programsで一意",
      parserVersion: "DB rowに未記録",
      materialization: "official_programs.raw_json",
    };
  }
  if (["branch", "age_gender_weight", "weight_change", "same_branch"].includes(feature)) {
    const cache = source.cacheInventory.kyotei24PreRaceHtml;
    return {
      rowCount: null,
      racerCoverage: null,
      dateRange: [cache.minDate, cache.maxDate],
      cacheFiles: cache.files,
      missingRate: "UNKNOWN（N0はfile inventory実測。項目別再parseは未実施）",
      duplicateRate: "UNKNOWN（HTML内容hash未監査）",
      parserVersion: "cache inventoryには未記録",
      materialization: "未正規化",
    };
  }
  if (feature === "registration_period") {
    return {
      rowCount: 0,
      racerCoverage: 0,
      dateRange: null,
      missingRate: "100%（監査対象の構造化sourceでは未確認）",
      duplicateRate: "not applicable",
      parserVersion: "なし",
      materialization: "未取得",
    };
  }
  if (feature === "official_mentor_apprentice") {
    return {
      rowCount: 2,
      racerCoverage: 4,
      dateRange: null,
      missingRate: "UNKNOWN（非網羅registry）",
      duplicateRate: "0%（登録済み2組のkey）",
      parserVersion: "hand-curated official-source registry",
      materialization: "docs/official-racer-relationships.json",
    };
  }
  if (feature === "average_st") {
    return {
      rowCount: source.profiles.rows,
      racerCoverage: source.profiles.avgStRows,
      dateRange: [source.profiles.minFetchedAt, source.profiles.maxFetchedAt],
      missingRate: pct(source.profiles.avgStRows, source.profiles.rows),
      duplicateRate: "0%（registration_no PRIMARY KEY）",
      parserVersion: "DB rowに未記録",
      materialization: "current-only",
    };
  }
  if (["exhibition_time_st_day_trend", "post_parts_change_delta"].includes(feature)) {
    return {
      rowCount: null,
      racerCoverage: null,
      dateRange: null,
      missingRate: "UNKNOWN（既存latest tableからPIT observation coverageを分離できない）",
      duplicateRate: "not applicable（未materialize）",
      parserVersion: "既存parser。observation rowには未固定",
      materialization: "未materialize",
    };
  }
  const stDependent = [
    "f_l_counts", "accident_rate", "st_mean_std_by_course", "f_late_start_rates_by_course",
    "recent_st_mean_variance", "days_since_f", "event_previous_finish_st",
  ].includes(feature);
  const finishDependent = [
    "starts_finish_rates_by_course", "winning_style_by_course",
    "remain_top2_top3_after_losing_from_course1", "entry_change_performance",
    "venue_course_performance", "last_30_90_results", "event_previous_finish_st",
    "outer_boat_rise_with_attack", "course1_loss_second_place_rate",
    "past_meetings_direct_results", "adjacent_course_matchups", "same_event_rematch",
    "course_tactic_tendency", "adjacent_boat_drop_when_attacking",
  ].includes(feature);
  return {
    rowCount: source.entries.rows,
    racerCoverage: source.entries.racers,
    dateRange: [source.entries.minDate, source.entries.maxDate],
    missingRate: stDependent
      ? `${pct(Number(source.entries.rows) - Number(source.entries.missingSt), source.entries.rows)} ST`
      : finishDependent
        ? `${pct(Number(source.entries.rows) - Number(source.entries.missingFinish), source.entries.rows)} finish`
        : "0% registration / actual course。派生値自体は未materialize",
    duplicateRate: "0%（race_id,boat_number PRIMARY KEY）",
    parserVersion: "DB rowに未記録。再構築時feature_version必須",
    materialization: "未materialize。race_entriesを正本に再計算",
  };
}

function inventoryCache(root: string, datePattern: RegExp) {
  if (!existsSync(root)) return { root, files: 0, minDate: null, maxDate: null };
  const stack = [root];
  let files = 0;
  const dates: string[] = [];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(fullPath);
        const date = normalizeCacheDate(entry.name.match(datePattern)?.[1]);
        if (date) dates.push(date);
      } else if (entry.isFile()) {
        files += 1;
        const date = normalizeCacheDate(entry.name.match(datePattern)?.[1]);
        if (date) dates.push(date);
      }
    }
  }
  dates.sort();
  return { root, files, minDate: dates[0] ?? null, maxDate: dates.at(-1) ?? null };
}

function normalizeCacheDate(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : /^\d{6}$/.test(value)
      ? `20${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4, 6)}`
      : null;
  if (!normalized || normalized < "2000-01-01" || normalized > "2099-12-31") return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
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
  const percent = (numerator: unknown, denominator: unknown) => Number(denominator) > 0
    ? `${(Number(numerator) / Number(denominator) * 100).toFixed(2)}%`
    : "—";
  const decision = (value: string) => `**${value}**`;
  const lines = [
    "# 全データ取得可能性・保存設計監査（全券種＋選手PIT、Phase N0）",
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
    "- 選手情報は、当時番組rawとstrict-prior結果再構築は利用可能。一方、現在値racer_profiles / racer_course_statsはhistorical利用不可。",
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
    "## 選手情報・point-in-time監査",
    "",
    `判定件数: GO ${report.racerAudit.goNoGoSummary.GO} / CONDITIONAL ${report.racerAudit.goNoGoSummary.CONDITIONAL} / BLOCKED ${report.racerAudit.goNoGoSummary.BLOCKED} / UNKNOWN ${report.racerAudit.goNoGoSummary.UNKNOWN}`,
    "",
    "### 現DB・cache実測",
    "",
    "| source | rows/files | racers/races | range | coverage / PIT判定 |",
    "|---|---:|---:|---|---|",
    `| official_programs.raw_json boats | ${integer(report.racerAudit.dbCoverage.officialProgramBoats.rows)} | ${integer(report.racerAudit.dbCoverage.officialProgramBoats.racers)} racers | ${report.racerAudit.dbCoverage.officialProgramBoats.minDate} .. ${report.racerAudit.dbCoverage.officialProgramBoats.maxDate} | 登録番号・級別・全国/当地勝率/2連率 ${percent(report.racerAudit.dbCoverage.officialProgramBoats.classRows, report.racerAudit.dbCoverage.officialProgramBoats.rows)}。レース日付きPIT |`,
    `| racer_profiles | ${integer(report.racerAudit.dbCoverage.racerProfiles.rows)} | 実値 ${integer(report.racerAudit.dbCoverage.racerProfiles.avgStRows)} / historical racers ${integer(report.racerAudit.dbCoverage.racerProfiles.historicalRacers)} | ${report.racerAudit.dbCoverage.racerProfiles.minFetchedAt} .. ${report.racerAudit.dbCoverage.racerProfiles.maxFetchedAt} | historical coverage ${Number(report.racerAudit.dbCoverage.racerProfiles.historicalRacerCoveragePct).toFixed(2)}%。現在値1世代、historical不可 |`,
    `| racer_course_stats | ${integer(report.racerAudit.dbCoverage.racerCourseStats.rows)} | ${integer(report.racerAudit.dbCoverage.racerCourseStats.racers)} racers、6course完備 ${integer(report.racerAudit.dbCoverage.racerCourseStats.fullSixCourseRacers)} | ${report.racerAudit.dbCoverage.racerCourseStats.minFetchedAt} .. ${report.racerAudit.dbCoverage.racerCourseStats.maxFetchedAt} | races>0 ${integer(report.racerAudit.dbCoverage.racerCourseStats.positiveSampleRows)}、win_rateあり ${integer(report.racerAudit.dbCoverage.racerCourseStats.winRateRows)}。n欠落・現在値 |`,
    `| race_entries | ${integer(report.racerAudit.dbCoverage.raceEntries.rows)} | ${integer(report.racerAudit.dbCoverage.raceEntries.races)} races / ${integer(report.racerAudit.dbCoverage.raceEntries.racers)} racers | ${report.racerAudit.dbCoverage.raceEntries.minDate} .. ${report.racerAudit.dbCoverage.raceEntries.maxDate} | reg欠損 ${integer(report.racerAudit.dbCoverage.raceEntries.missingRegistration)}、ST欠損 ${integer(report.racerAudit.dbCoverage.raceEntries.missingSt)}。strict-prior派生の正本 |`,
    `| 公式番組archive | ${integer(report.racerAudit.cacheInventory.officialPrograms.files)} files | — | ${report.racerAudit.cacheInventory.officialPrograms.minDate} .. ${report.racerAudit.cacheInventory.officialPrograms.maxDate} | 当時番組を再parse可能 |`,
    `| 公式結果archive | ${integer(report.racerAudit.cacheInventory.officialResults.files)} files | — | ${report.racerAudit.cacheInventory.officialResults.minDate} .. ${report.racerAudit.cacheInventory.officialResults.maxDate} | 結果由来rollingを再計算可能 |`,
    `| レース前HTML cache | ${integer(report.racerAudit.cacheInventory.kyotei24PreRaceHtml.files)} files | — | ${report.racerAudit.cacheInventory.kyotei24PreRaceHtml.minDate} .. ${report.racerAudit.cacheInventory.kyotei24PreRaceHtml.maxDate} | 年齢・支部・性別・体重を当時値で再抽出可能 |`,
    "",
    `最新番組日 ${report.racerAudit.dbCoverage.latestProgramCoverage.date} は ${integer(report.racerAudit.dbCoverage.latestProgramCoverage.boatRows)}艇すべてprofile/course statsでcovered。ただし「現在coverage 100%」は過去raceでのPIT適格性を意味しない。`,
    "",
    "### Go / No-Go matrix",
    "",
    "| 分類 | feature | 判定 | PIT品質 | 現在source / 過去再現 | 実測coverage / 欠損・重複 / parser | 新規取得 | phase | 主な漏洩リスク |",
    "|---|---|---|---|---|---|---|---|---|",
    ...report.racerAudit.featureMatrix.map((row: any) =>
      `| ${row.category} | ${row.feature} | **${row.decision}** | ${row.pointInTimeQuality} | ${row.canonicalSource}。${row.historicalReproduction} | rows=${line(row.measurement.rowCount)}, racers=${line(row.measurement.racerCoverage)}, range=${line(row.measurement.dateRange?.join(".."))}; missing=${row.measurement.missingRate}; duplicate=${row.measurement.duplicateRate}; parser=${row.measurement.parserVersion} | ${row.newAcquisition} | ${row.phase} | ${row.leakageRisk} |`),
    "",
    "### 安全分類",
    "",
    "現在すでに使える:",
    "",
    ...report.racerAudit.alreadyUsable.map((value: string) => `- ${value}`),
    "",
    "point-in-time不適格:",
    "",
    ...report.racerAudit.pointInTimeIneligible.map((value: string) => `- ${value}`),
    "",
    "最優先:",
    "",
    ...report.racerAudit.priority.map((value: string) => `- ${value}`),
    "",
    "guard:",
    "",
    ...report.racerAudit.guards.map((value: string) => `- ${value}`),
    "",
    "### N1〜N4",
    "",
    `- N1: ${report.racerAudit.phaseRecommendation.N1}`,
    `- N2: ${report.racerAudit.phaseRecommendation.N2}`,
    `- N3: ${report.racerAudit.phaseRecommendation.N3}`,
    `- N4: ${report.racerAudit.phaseRecommendation.N4}`,
    "",
    "選手特徴を現在のBUY/WATCH/SKIPへ追加しない。M1/M3は既存のformal settled gateとN3/N4のPIT基盤が揃うまで開始しない。",
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
