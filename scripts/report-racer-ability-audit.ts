/**
 * report-racer-ability-audit.ts — 読み取り専用
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP/ALTER, app_settings変更, 本番decision変更
 * 禁止: ROI候補探索・買い条件作成・exacta forward candidates の変更・自動投票
 *
 * 目的:
 *   選手能力データ（級別/勝率/平均ST/F/L/ability_index/コース別成績/モーター・ボート成績）が
 *   DB内のどこにどれだけ存在するかを母集団別に棚卸しし、point-in-time 安全性を分類する。
 *   ROI評価は一切行わない。coverage と時点整合性のみを見る。
 *
 * 出力:
 *   reports/racer-ability-data-audit.md
 *   reports/racer-ability-data-audit.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const CANDIDATES_PATH = "data/exacta-forward-candidates.json";
const OUT_MD = "reports/racer-ability-data-audit.md";
const OUT_JSON = "reports/racer-ability-data-audit.json";

// raw_json の boats[] から読む番組表掲載フィールド（出走表に印刷される時点データ）
const PROGRAM_FIELDS = [
  "className",
  "nationalWinRate",
  "nationalTop2Rate",
  "localWinRate",
  "localTop2Rate",
  "motorTop2Rate",
  "boatTop2Rate",
] as const;

type ProgramField = (typeof PROGRAM_FIELDS)[number];

type BoatRaw = Record<string, unknown>;

type ProgramRow = { race_id: string; date: string; raw_json: string };

type CandidateFilter =
  | { type: "wind_band"; minInclusive: number; maxExclusive: number }
  | { type: "venue"; venue: string }
  | { type: "race_no"; raceNo: number };

type Candidate = {
  id: string;
  label: string;
  priority: number;
  combo: string;
  filter: CandidateFilter;
};

type CandidateFile = {
  lockedAt: string;
  basePopulation: {
    runKind: string;
    decision: string;
    selection: string;
    excludedVenues: string[];
    excludedRaceNos: number[];
  };
  candidates: Candidate[];
};

type PopulationCoverage = {
  population: string;
  description: string;
  races: number;
  boats: number;
  distinctRacers: number;
  programFieldCoverage: Record<ProgramField, { nonNull: number; pct: number | null }>;
  snapshotCoverage: {
    inRacerProfilesReal: { nonNull: number; pct: number | null };
    profileAvgSt: { nonNull: number; pct: number | null };
    profileAbilityIndex: { nonNull: number; pct: number | null };
    profileFlyingCount: { nonNull: number; pct: number | null };
    profileLateStartCount: { nonNull: number; pct: number | null };
    courseStatsRow: { nonNull: number; pct: number | null };
    courseAvgSt: { nonNull: number; pct: number | null };
    courseTop3Rate: { nonNull: number; pct: number | null };
    courseEntryRate: { nonNull: number; pct: number | null };
    courseStartOrder: { nonNull: number; pct: number | null };
  };
  motorBoatStats: {
    raceCourseRows: number;
    motorTop2Rate: { nonNull: number; pct: number | null };
    boatTop2Rate: { nonNull: number; pct: number | null };
  };
};

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

try {
  main();
} finally {
  db.close();
}

function main() {
  const candidateFile = JSON.parse(readFileSync(CANDIDATES_PATH, "utf8")) as CandidateFile;

  // ── 1. スキーマ棚卸し ────────────────────────────────────────────────
  const schemaInventory = {
    racer_profiles: tableColumns("racer_profiles"),
    racer_course_stats: tableColumns("racer_course_stats"),
    race_entries: tableColumns("race_entries"),
    motor_boat_stats: tableColumns("motor_boat_stats"),
    official_programs: tableColumns("official_programs"),
  };

  // ── 1b. raw_json キー存在調査（年別サンプル） ─────────────────────────
  const rawJsonKeySurvey = surveyRawJsonKeys();
  const missingBoats = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN date >= '2026-01-01' THEN 1 ELSE 0 END) AS in_2026
       FROM official_programs WHERE json_extract(raw_json,'$.boats') IS NULL`,
    )
    .get() as { total: number; in_2026: number };

  // ── スナップショットテーブルの実体（point-in-time 監査の土台） ────────
  const profileMap = loadProfileMap();
  const courseStatsMap = loadCourseStatsMap();
  const snapshotMeta = {
    racerProfiles: db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN flying_count IS NOT NULL THEN 1 ELSE 0 END) AS real_rows,
                MIN(fetched_at) AS min_fetched, MAX(fetched_at) AS max_fetched
         FROM racer_profiles`,
      )
      .get() as Record<string, unknown>,
    racerCourseStats: db
      .prepare(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT registration_no) AS racers,
                MIN(fetched_at) AS min_fetched, MAX(fetched_at) AS max_fetched
         FROM racer_course_stats`,
      )
      .get() as Record<string, unknown>,
    motorBoatStats: db
      .prepare(`SELECT COUNT(*) AS total, MIN(date) AS min_date, MAX(date) AS max_date FROM motor_boat_stats`)
      .get() as Record<string, unknown>,
  };

  // ── 2. 母集団別 coverage ─────────────────────────────────────────────
  const latestDate = (db.prepare(`SELECT MAX(date) AS d FROM official_programs`).get() as { d: string }).d;

  const populations: PopulationCoverage[] = [];

  // 全登録選手（racer_profiles / racer_course_stats 自体の充足率）
  const allRegistered = summarizeRegisteredRacers();

  // 今日（=最新program日）の出走選手
  populations.push(
    coverageForPrograms(
      "today_entrants",
      `最新program日 ${latestDate} の全出走艇`,
      db
        .prepare(`SELECT race_id, date, raw_json FROM official_programs WHERE date = ?`)
        .all(latestDate) as ProgramRow[],
      profileMap,
      courseStatsMap,
    ),
  );

  // 今日のBUY候補（paper-live BUY）
  const todayBuyRaceIds = (
    db
      .prepare(
        `SELECT DISTINCT race_id FROM decision_history WHERE run_kind='paper-live' AND decision='BUY' AND date = ?`,
      )
      .all(latestDate) as Array<{ race_id: string }>
  ).map((r) => r.race_id);
  populations.push(
    coverageForPrograms(
      "today_buy",
      `paper-live BUY（${latestDate}）`,
      loadProgramsByRaceIds(todayBuyRaceIds),
      profileMap,
      courseStatsMap,
    ),
  );

  // historical-backfill BUY 集合（全期間 / 2024 held-out / 2025+ forward / lockedAt以降）
  const buyPopDefs: Array<{ name: string; description: string; where: string; params: string[] }> = [
    {
      name: "historical_backfill_buy_all",
      description: "historical-backfill BUY 全期間",
      where: "",
      params: [],
    },
    {
      name: "held_out_2024_buy",
      description: "historical-backfill BUY 2024 held-out",
      where: "AND dh.date >= '2024-01-01' AND dh.date <= '2024-12-31'",
      params: [],
    },
    {
      name: "forward_2025_plus_buy",
      description: "historical-backfill BUY 2025-01-01 以降 forward",
      where: "AND dh.date >= '2025-01-01'",
      params: [],
    },
    {
      name: "since_locked_at_buy",
      description: `historical-backfill BUY lockedAt(${candidateFile.lockedAt}) 以降`,
      where: "AND dh.date >= ?",
      params: [candidateFile.lockedAt],
    },
  ];
  for (const def of buyPopDefs) {
    const raceIds = (
      db
        .prepare(
          `SELECT DISTINCT dh.race_id FROM decision_history dh
           WHERE dh.run_kind='historical-backfill' AND dh.decision='BUY' ${def.where}`,
        )
        .all(...def.params) as Array<{ race_id: string }>
    ).map((r) => r.race_id);
    populations.push(
      coverageForPrograms(def.name, def.description, loadProgramsByRaceIds(raceIds), profileMap, courseStatsMap),
    );
  }

  // ── 5. exacta forward monitor 固定6候補の coverage ────────────────────
  // forward期（lockedAt以降）はまだレースが貯まっていないため、
  // 参考として lock前の同条件母集団（sweepと同じ basePopulation）でも coverage を出す。
  const monitorBaseRaces = loadMonitorBaseRaces(candidateFile, "forward");
  const preLockBaseRaces = loadMonitorBaseRaces(candidateFile, "pre-lock");
  const candidateCoverage = candidateFile.candidates
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((candidate) => {
      const secondCourse = Number(candidate.combo.split("-")[1]);
      const coverageFor = (races: typeof monitorBaseRaces) => {
        const matched = races.filter((race) => matchesCandidate(candidate.filter, race));
        const raceIds = matched.map((r) => r.race_id);
        const programs = loadProgramsByRaceIds(raceIds);
        return {
          matchedRaces: matched.length,
          firstBoat: coverageForBoatsOfCourse(programs, 1, profileMap, courseStatsMap),
          secondBoat: coverageForBoatsOfCourse(programs, secondCourse, profileMap, courseStatsMap),
          motorBoatStats: motorBoatCoverageForCourses(raceIds, [1, secondCourse]),
        };
      };
      return {
        id: candidate.id,
        label: candidate.label,
        combo: candidate.combo,
        forward: coverageFor(monitorBaseRaces),
        preLockReference: coverageFor(preLockBaseRaces),
      };
    });

  // ── 3. point-in-time 監査 ────────────────────────────────────────────
  const pointInTime = auditPointInTime(latestDate);

  // ── 6. 安全分類 ──────────────────────────────────────────────────────
  const safetyClassification = buildSafetyClassification();

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    mode: "read-only racer ability data audit",
    warning:
      "本レポートは coverage / point-in-time 安全性の監査のみ。ROI評価・買い条件作成・候補変更は行わない。",
    schemaInventory,
    rawJsonKeySurvey,
    rawJsonMissingBoats: missingBoats,
    snapshotMeta,
    allRegistered,
    populations,
    candidateCoverage,
    pointInTime,
    safetyClassification,
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[report-racer-ability-audit] populations=${populations.length} candidates=${candidateCoverage.length}`);
  console.log(`[report-racer-ability-audit] wrote ${OUT_MD}`);
  console.log(`[report-racer-ability-audit] wrote ${OUT_JSON}`);
}

// ───────────────────────────── helpers ─────────────────────────────

function tableColumns(table: string): Array<{ name: string; type: string; notNull: boolean }> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: String(row.name),
    type: String(row.type),
    notNull: Number(row.notnull) === 1,
  }));
}

function surveyRawJsonKeys() {
  const years = (
    db.prepare(`SELECT DISTINCT substr(date,1,4) AS yr FROM official_programs ORDER BY yr`).all() as Array<{
      yr: string;
    }>
  ).map((r) => r.yr);
  const result: Array<{
    year: string;
    sampled: number;
    boatsPresent: number;
    keyPresence: Record<string, number>;
  }> = [];
  for (const year of years) {
    const rows = db
      .prepare(`SELECT raw_json FROM official_programs WHERE date >= ? AND date <= ? LIMIT 200`)
      .all(`${year}-01-01`, `${year}-12-31`) as Array<{ raw_json: string }>;
    let boatsPresent = 0;
    const keyPresence: Record<string, number> = {};
    for (const row of rows) {
      let parsed: { boats?: BoatRaw[] };
      try {
        parsed = JSON.parse(row.raw_json) as { boats?: BoatRaw[] };
      } catch {
        continue;
      }
      const boats = Array.isArray(parsed.boats) ? parsed.boats : [];
      if (boats.length === 0) continue;
      boatsPresent += 1;
      for (const key of Object.keys(boats[0])) {
        keyPresence[key] = (keyPresence[key] ?? 0) + 1;
      }
    }
    result.push({ year, sampled: rows.length, boatsPresent, keyPresence });
  }
  return result;
}

function loadProfileMap() {
  const rows = db
    .prepare(
      `SELECT registration_no, flying_count, late_start_count, avg_st, ability_index FROM racer_profiles`,
    )
    .all() as Array<Record<string, unknown>>;
  const map = new Map<
    string,
    { real: boolean; avgSt: boolean; ability: boolean; flying: boolean; late: boolean }
  >();
  for (const row of rows) {
    map.set(String(row.registration_no), {
      real: row.flying_count != null,
      avgSt: row.avg_st != null,
      ability: row.ability_index != null,
      flying: row.flying_count != null,
      late: row.late_start_count != null,
    });
  }
  return map;
}

function loadCourseStatsMap() {
  const rows = db
    .prepare(
      `SELECT registration_no, course, avg_st, top3_rate, entry_rate, start_order FROM racer_course_stats`,
    )
    .all() as Array<Record<string, unknown>>;
  const map = new Map<string, { avgSt: boolean; top3: boolean; entry: boolean; startOrder: boolean }>();
  for (const row of rows) {
    map.set(`${row.registration_no}-${row.course}`, {
      avgSt: row.avg_st != null,
      top3: row.top3_rate != null,
      entry: row.entry_rate != null,
      startOrder: row.start_order != null,
    });
  }
  return map;
}

function loadProgramsByRaceIds(raceIds: string[]): ProgramRow[] {
  const result: ProgramRow[] = [];
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT race_id, date, raw_json FROM official_programs WHERE race_id IN (${placeholders})`)
      .all(...ids) as ProgramRow[];
    result.push(...rows);
  }
  return result;
}

function summarizeRegisteredRacers() {
  const profiles = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN flying_count IS NOT NULL THEN 1 ELSE 0 END) AS real_rows,
              SUM(CASE WHEN avg_st IS NOT NULL THEN 1 ELSE 0 END) AS has_avg_st,
              SUM(CASE WHEN ability_index IS NOT NULL THEN 1 ELSE 0 END) AS has_ability,
              SUM(CASE WHEN top3_rate IS NOT NULL THEN 1 ELSE 0 END) AS has_top3
       FROM racer_profiles`,
    )
    .get() as Record<string, number>;
  const courseStats = db
    .prepare(
      `SELECT COUNT(DISTINCT registration_no) AS racers, COUNT(*) AS rows,
              SUM(CASE WHEN avg_st IS NOT NULL THEN 1 ELSE 0 END) AS has_avg_st,
              SUM(CASE WHEN top3_rate IS NOT NULL THEN 1 ELSE 0 END) AS has_top3,
              SUM(CASE WHEN entry_rate IS NOT NULL THEN 1 ELSE 0 END) AS has_entry,
              SUM(CASE WHEN start_order IS NOT NULL THEN 1 ELSE 0 END) AS has_start_order
       FROM racer_course_stats`,
    )
    .get() as Record<string, number>;
  return { profiles, courseStats };
}

function coverageForPrograms(
  population: string,
  description: string,
  programs: ProgramRow[],
  profileMap: ReturnType<typeof loadProfileMap>,
  courseStatsMap: ReturnType<typeof loadCourseStatsMap>,
): PopulationCoverage {
  const programCounts: Record<ProgramField, number> = Object.fromEntries(
    PROGRAM_FIELDS.map((f) => [f, 0]),
  ) as Record<ProgramField, number>;
  let boats = 0;
  const racers = new Set<string>();
  let inProfiles = 0;
  let profileAvgSt = 0;
  let profileAbility = 0;
  let profileFlying = 0;
  let profileLate = 0;
  let courseRow = 0;
  let courseAvgSt = 0;
  let courseTop3 = 0;
  let courseEntry = 0;
  let courseStartOrder = 0;

  for (const program of programs) {
    let parsed: { boats?: BoatRaw[] };
    try {
      parsed = JSON.parse(program.raw_json) as { boats?: BoatRaw[] };
    } catch {
      continue;
    }
    const boatList = Array.isArray(parsed.boats) ? parsed.boats : [];
    for (const boat of boatList) {
      boats += 1;
      for (const field of PROGRAM_FIELDS) {
        const value = boat[field];
        if (value != null && value !== "") programCounts[field] += 1;
      }
      const reg = boat.registrationNo == null ? "" : String(boat.registrationNo);
      const course = Number(boat.course);
      if (reg) {
        racers.add(reg);
        const profile = profileMap.get(reg);
        if (profile?.real) inProfiles += 1;
        if (profile?.avgSt) profileAvgSt += 1;
        if (profile?.ability) profileAbility += 1;
        if (profile?.flying) profileFlying += 1;
        if (profile?.late) profileLate += 1;
        const stat = courseStatsMap.get(`${reg}-${course}`);
        if (stat) courseRow += 1;
        if (stat?.avgSt) courseAvgSt += 1;
        if (stat?.top3) courseTop3 += 1;
        if (stat?.entry) courseEntry += 1;
        if (stat?.startOrder) courseStartOrder += 1;
      }
    }
  }

  const motor = motorBoatCoverageForCourses(
    programs.map((p) => p.race_id),
    null,
  );

  const pctOf = (n: number) => (boats === 0 ? null : round2((n / boats) * 100));
  return {
    population,
    description,
    races: programs.length,
    boats,
    distinctRacers: racers.size,
    programFieldCoverage: Object.fromEntries(
      PROGRAM_FIELDS.map((f) => [f, { nonNull: programCounts[f], pct: pctOf(programCounts[f]) }]),
    ) as PopulationCoverage["programFieldCoverage"],
    snapshotCoverage: {
      inRacerProfilesReal: { nonNull: inProfiles, pct: pctOf(inProfiles) },
      profileAvgSt: { nonNull: profileAvgSt, pct: pctOf(profileAvgSt) },
      profileAbilityIndex: { nonNull: profileAbility, pct: pctOf(profileAbility) },
      profileFlyingCount: { nonNull: profileFlying, pct: pctOf(profileFlying) },
      profileLateStartCount: { nonNull: profileLate, pct: pctOf(profileLate) },
      courseStatsRow: { nonNull: courseRow, pct: pctOf(courseRow) },
      courseAvgSt: { nonNull: courseAvgSt, pct: pctOf(courseAvgSt) },
      courseTop3Rate: { nonNull: courseTop3, pct: pctOf(courseTop3) },
      courseEntryRate: { nonNull: courseEntry, pct: pctOf(courseEntry) },
      courseStartOrder: { nonNull: courseStartOrder, pct: pctOf(courseStartOrder) },
    },
    motorBoatStats: motor,
  };
}

function coverageForBoatsOfCourse(
  programs: ProgramRow[],
  course: number,
  profileMap: ReturnType<typeof loadProfileMap>,
  courseStatsMap: ReturnType<typeof loadCourseStatsMap>,
) {
  let boats = 0;
  let className = 0;
  let nationalWinRate = 0;
  let localWinRate = 0;
  let inProfiles = 0;
  let profileAvgSt = 0;
  let profileAbility = 0;
  let courseAvgSt = 0;
  let courseTop3 = 0;
  for (const program of programs) {
    let parsed: { boats?: BoatRaw[] };
    try {
      parsed = JSON.parse(program.raw_json) as { boats?: BoatRaw[] };
    } catch {
      continue;
    }
    const boat = (Array.isArray(parsed.boats) ? parsed.boats : []).find((b) => Number(b.course) === course);
    if (!boat) continue;
    boats += 1;
    if (boat.className != null && boat.className !== "") className += 1;
    if (boat.nationalWinRate != null) nationalWinRate += 1;
    if (boat.localWinRate != null) localWinRate += 1;
    const reg = boat.registrationNo == null ? "" : String(boat.registrationNo);
    if (reg) {
      const profile = profileMap.get(reg);
      if (profile?.real) inProfiles += 1;
      if (profile?.avgSt) profileAvgSt += 1;
      if (profile?.ability) profileAbility += 1;
      const stat = courseStatsMap.get(`${reg}-${course}`);
      if (stat?.avgSt) courseAvgSt += 1;
      if (stat?.top3) courseTop3 += 1;
    }
  }
  const pctOf = (n: number) => (boats === 0 ? null : round2((n / boats) * 100));
  return {
    course,
    boats,
    className: { nonNull: className, pct: pctOf(className) },
    nationalWinRate: { nonNull: nationalWinRate, pct: pctOf(nationalWinRate) },
    localWinRate: { nonNull: localWinRate, pct: pctOf(localWinRate) },
    inRacerProfilesReal: { nonNull: inProfiles, pct: pctOf(inProfiles) },
    profileAvgSt: { nonNull: profileAvgSt, pct: pctOf(profileAvgSt) },
    profileAbilityIndex: { nonNull: profileAbility, pct: pctOf(profileAbility) },
    courseAvgSt: { nonNull: courseAvgSt, pct: pctOf(courseAvgSt) },
    courseTop3Rate: { nonNull: courseTop3, pct: pctOf(courseTop3) },
  };
}

function motorBoatCoverageForCourses(raceIds: string[], courses: number[] | null) {
  let rows = 0;
  let motor = 0;
  let boat = 0;
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const courseFilter = courses ? `AND course IN (${courses.map(() => "?").join(",")})` : "";
    const params: Array<string | number> = [...ids, ...(courses ?? [])];
    const row = db
      .prepare(
        `SELECT COUNT(*) AS rows,
                SUM(CASE WHEN motor_top2_rate IS NOT NULL THEN 1 ELSE 0 END) AS motor,
                SUM(CASE WHEN boat_top2_rate IS NOT NULL THEN 1 ELSE 0 END) AS boat
         FROM motor_boat_stats WHERE race_id IN (${placeholders}) ${courseFilter}`,
      )
      .get(...params) as Record<string, number>;
    rows += Number(row.rows ?? 0);
    motor += Number(row.motor ?? 0);
    boat += Number(row.boat ?? 0);
  }
  // 期待行数 = レース数 × 対象コース数（courses=null は6艇）
  const expected = raceIds.length * (courses ? courses.length : 6);
  const pctOf = (n: number) => (expected === 0 ? null : round2((n / expected) * 100));
  return {
    raceCourseRows: rows,
    motorTop2Rate: { nonNull: motor, pct: pctOf(motor) },
    boatTop2Rate: { nonNull: boat, pct: pctOf(boat) },
  };
}

/** report-exacta-forward-monitor.ts の loadBaseRaces と同じ母集団（読み取りのみ・条件変更なし）。
 *  mode="forward" は lockedAt以降（monitorと同一）、mode="pre-lock" は lockedAt より前（参考coverage用）。 */
function loadMonitorBaseRaces(file: CandidateFile, mode: "forward" | "pre-lock") {
  const venuePlaceholders = file.basePopulation.excludedVenues.map(() => "?").join(",");
  const raceNoPlaceholders = file.basePopulation.excludedRaceNos.map(() => "?").join(",");
  const dateCondition = mode === "forward" ? "AND dh.date >= ?" : "AND dh.date < ?";
  const params = [
    file.basePopulation.runKind,
    file.basePopulation.decision,
    file.basePopulation.selection,
    file.lockedAt,
    ...file.basePopulation.excludedVenues,
    ...file.basePopulation.excludedRaceNos,
  ];
  return db
    .prepare(
      `SELECT DISTINCT dh.race_id, dh.date, dh.venue, dh.race_no, rw.wind_speed_mps AS wind_speed
       FROM decision_history dh
       LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
       WHERE dh.run_kind = ?
         AND dh.decision = ?
         AND dh.selection = ?
         AND dh.current_odds IS NOT NULL
         AND dh.result IS NOT NULL
         AND dh.result != ''
         ${dateCondition}
         AND dh.venue NOT IN (${venuePlaceholders})
         AND dh.race_no NOT IN (${raceNoPlaceholders})
         AND NOT EXISTS (
           SELECT 1 FROM race_entries re
           WHERE re.race_id = dh.race_id
             AND (re.status_code LIKE 'F%' OR re.status_code LIKE 'L%')
         )
       ORDER BY dh.date, dh.venue, dh.race_no`,
    )
    .all(...params) as Array<{ race_id: string; date: string; venue: string; race_no: number; wind_speed: number | null }>;
}

function matchesCandidate(
  filter: CandidateFilter,
  race: { venue: string; race_no: number; wind_speed: number | null },
): boolean {
  if (filter.type === "venue") return race.venue === filter.venue;
  if (filter.type === "race_no") return race.race_no === filter.raceNo;
  if (race.wind_speed == null) return false;
  return race.wind_speed >= filter.minInclusive && race.wind_speed < filter.maxExclusive;
}

function auditPointInTime(latestDate: string) {
  // racer_profiles / racer_course_stats の fetched_at と、historical BUY のレース日を比較
  const profileFetch = db
    .prepare(`SELECT MIN(fetched_at) AS min_f, MAX(fetched_at) AS max_f FROM racer_profiles`)
    .get() as { min_f: string | null; max_f: string | null };
  const courseFetch = db
    .prepare(`SELECT MIN(fetched_at) AS min_f, MAX(fetched_at) AS max_f FROM racer_course_stats`)
    .get() as { min_f: string | null; max_f: string | null };
  const buyDates = db
    .prepare(
      `SELECT MIN(date) AS min_d, MAX(date) AS max_d, COUNT(DISTINCT race_id) AS races
       FROM decision_history WHERE run_kind='historical-backfill' AND decision='BUY'`,
    )
    .get() as { min_d: string | null; max_d: string | null; races: number };

  // fetched_at がレース日より新しい行を historical BUY に注入していた証拠:
  // feature_adjustment_breakdown の courseStFactor / courseTop3Factor が非中立の行
  const breakdownEvidence = db
    .prepare(
      `SELECT
         COUNT(*) AS rows_with_breakdown,
         SUM(CASE WHEN json_extract(feature_adjustment_breakdown,'$.courseStFactor') != 1
                    OR json_extract(feature_adjustment_breakdown,'$.courseTop3Factor') != 1
                  THEN 1 ELSE 0 END) AS course_factor_active,
         SUM(CASE WHEN json_extract(feature_adjustment_breakdown,'$.exhibitionResidualFactor') != 1
                  THEN 1 ELSE 0 END) AS exhibition_residual_active,
         MIN(date) AS min_date, MAX(date) AS max_date
       FROM decision_history
       WHERE run_kind='historical-backfill' AND feature_adjustment_breakdown IS NOT NULL`,
    )
    .get() as Record<string, unknown>;

  // スナップショットは何日分の歴史を持つか（= 1世代しかないか）
  const profileFetchDays = db
    .prepare(`SELECT COUNT(DISTINCT substr(fetched_at,1,10)) AS days FROM racer_profiles`)
    .get() as { days: number };
  const courseFetchDays = db
    .prepare(`SELECT COUNT(DISTINCT substr(fetched_at,1,10)) AS days FROM racer_course_stats`)
    .get() as { days: number };

  return {
    latestProgramDate: latestDate,
    racerProfiles: {
      fetchedAtRange: profileFetch,
      distinctFetchDays: profileFetchDays.days,
      note: "1世代スナップショットのみ。snapshot履歴なし → 過去レースに当てると未来情報リーク。",
    },
    racerCourseStats: {
      fetchedAtRange: courseFetch,
      distinctFetchDays: courseFetchDays.days,
      note: "同上。enrichFeatures は registrationNo+course だけでJOINし日付条件なし。",
    },
    historicalBuyDateRange: buyDates,
    leakEvidence: {
      description:
        "historical-backfill 行の feature_adjustment_breakdown に courseStFactor/courseTop3Factor 非中立が存在する場合、" +
        "fetched_at がレース日より後のスナップショットを過去レースに適用した証拠になる。",
      ...breakdownEvidence,
    },
    motorBoatStats: {
      note: "race_id 単位で当日番組から取り込むためレース時点で利用可能。point-in-time 安全。",
    },
    officialProgramsRawJson: {
      note: "出走表は前売り時点で公表される情報。レース日キー付きで保存されており point-in-time 安全。",
    },
  };
}

function buildSafetyClassification() {
  // classification: usable_for_historical / usable_for_live_only / unsafe_due_to_point_in_time_leakage /
  //                 missing_or_low_coverage / needs_backfill / needs_schema_change /
  //                 currently_used_in_decision / not_used_in_decision
  return [
    {
      feature: "className (A1/A2/B1/B2)",
      source: "official_programs.raw_json boats[].className",
      classifications: ["usable_for_historical", "currently_used_in_decision"],
      notes: "出走表掲載の時点データ。programFeatures.ts classAdjustment/supportClassAdjustment で使用中。",
    },
    {
      feature: "nationalWinRate",
      source: "official_programs.raw_json boats[].nationalWinRate",
      classifications: ["usable_for_historical", "currently_used_in_decision"],
      notes: "出走表掲載の時点データ。1着候補の nationalFactor で使用中。",
    },
    {
      feature: "nationalTop2Rate",
      source: "official_programs.raw_json boats[].nationalTop2Rate",
      classifications: ["usable_for_historical", "not_used_in_decision"],
      notes: "出走表掲載の時点データ。BoatFeature に取り込み済みだが補正係数では未使用。",
    },
    {
      feature: "nationalTop3Rate",
      source: "（存在しない）",
      classifications: ["missing_or_low_coverage", "needs_schema_change"],
      notes: "出走表raw_jsonにもDBにも全国3連率は存在しない。取得元の追加が必要。",
    },
    {
      feature: "localWinRate",
      source: "official_programs.raw_json boats[].localWinRate",
      classifications: ["usable_for_historical", "currently_used_in_decision"],
      notes: "出走表掲載の時点データ。1着・2着候補の localFactor で使用中。",
    },
    {
      feature: "localTop2Rate",
      source: "official_programs.raw_json boats[].localTop2Rate",
      classifications: ["usable_for_historical", "not_used_in_decision"],
      notes: "出走表掲載の時点データ。取り込み済みだが補正係数では未使用。",
    },
    {
      feature: "localTop3Rate",
      source: "（存在しない）",
      classifications: ["missing_or_low_coverage", "needs_schema_change"],
      notes: "当地3連率は存在しない。",
    },
    {
      feature: "motorTop2Rate（全国）",
      source: "official_programs.raw_json boats[].motorTop2Rate",
      classifications: ["usable_for_historical", "currently_used_in_decision"],
      notes: "出走表掲載の時点データ。venueMotorTop2Rate のフォールバックとして使用中。",
    },
    {
      feature: "boatTop2Rate（全国）",
      source: "official_programs.raw_json boats[].boatTop2Rate",
      classifications: ["usable_for_historical", "currently_used_in_decision"],
      notes: "出走表掲載の時点データ。venueBoatTop2Rate のフォールバックとして使用中。",
    },
    {
      feature: "venueMotorTop2Rate / venueBoatTop2Rate",
      source: "motor_boat_stats (race_id, course 単位)",
      classifications: ["usable_for_historical", "currently_used_in_decision"],
      notes: "レースごとに当日の番組から保存。2024-01-01以降のみ。それ以前は needs_backfill。",
    },
    {
      feature: "avg_st（全コース平均ST）",
      source: "racer_profiles.avg_st（現在値スナップショット）",
      classifications: ["usable_for_live_only", "unsafe_due_to_point_in_time_leakage", "not_used_in_decision"],
      notes: "fetched_at 2026-05/06 の1世代のみ。過去レースに当てるとリーク。decision の補正係数では未使用。",
    },
    {
      feature: "ability_index",
      source: "racer_profiles.ability_index（現在値スナップショット）",
      classifications: ["usable_for_live_only", "unsafe_due_to_point_in_time_leakage", "not_used_in_decision"],
      notes: "同上。decision では未使用。",
    },
    {
      feature: "flying_count / late_start_count",
      source: "racer_profiles（現在値スナップショット）",
      classifications: ["usable_for_live_only", "unsafe_due_to_point_in_time_leakage", "not_used_in_decision"],
      notes: "BoatFeature に注入されるが補正係数では未使用。歴史検証に使うなら期別スナップショットが必要。",
    },
    {
      feature: "courseAvgSt / courseTop3Rate（コース別）",
      source: "racer_course_stats（現在値スナップショット）",
      classifications: ["usable_for_live_only", "unsafe_due_to_point_in_time_leakage", "currently_used_in_decision"],
      notes:
        "courseStFactor / courseTop3Factor として decision に影響。enrichFeatures に日付条件がないため、" +
        "historical-backfill 再生成時に過去レースへ現在値が注入される（leakEvidence 参照）。",
    },
    {
      feature: "courseEntryRate / courseStartOrder",
      source: "racer_course_stats（現在値スナップショット）",
      classifications: ["usable_for_live_only", "unsafe_due_to_point_in_time_leakage", "not_used_in_decision"],
      notes: "保存のみ。補正係数では未使用。",
    },
    {
      feature: "exhibitionStResidual",
      source: "exhibition_data（当日直前情報） − racer_course_stats.avg_st（現在値）",
      classifications: ["usable_for_live_only", "unsafe_due_to_point_in_time_leakage", "currently_used_in_decision"],
      notes:
        "展示ST自体は当日情報で安全だが、基準側の courseAvgSt が現在値スナップショットのため残差は時点不整合。",
    },
    {
      feature: "race_entries（racer_reg/entry_course/st/finish_pos 等）",
      source: "race_entries（結果確定後データ）",
      classifications: ["usable_for_historical", "not_used_in_decision"],
      notes:
        "結果データとしては全期間あり。ただし『そのレースのst/finish_pos』は事後情報なので、" +
        "特徴量にするなら race_date より前のレースだけで as-of 集計すること。",
    },
  ];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function fmtPct(value: number | null) {
  return value == null ? "n/a" : `${value.toFixed(1)}%`;
}

function renderMarkdown(report: ReturnType<typeof buildReportType>): string {
  const lines: string[] = [];
  lines.push("# 選手能力データ監査レポート（point-in-time 安全性）");
  lines.push("");
  lines.push(`生成日時: ${report.generatedAt}`);
  lines.push(`DB: ${report.dbPath}`);
  lines.push("");
  lines.push(`> ${report.warning}`);
  lines.push("");

  lines.push("## 1. スキーマ棚卸し");
  lines.push("");
  for (const [table, cols] of Object.entries(report.schemaInventory)) {
    lines.push(`- **${table}**: ${cols.map((c) => c.name).join(", ")}`);
  }
  lines.push("");

  lines.push("## 2. raw_json boats[] キー存在調査（年別サンプル200件）");
  lines.push("");
  lines.push("| 年 | sampled | boats[]あり | className | nationalWinRate | localWinRate | motorTop2Rate | boatTop2Rate |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const row of report.rawJsonKeySurvey) {
    lines.push(
      `| ${row.year} | ${row.sampled} | ${row.boatsPresent} | ${row.keyPresence.className ?? 0} | ${row.keyPresence.nationalWinRate ?? 0} | ${row.keyPresence.localWinRate ?? 0} | ${row.keyPresence.motorTop2Rate ?? 0} | ${row.keyPresence.boatTop2Rate ?? 0} |`,
    );
  }
  lines.push("");
  lines.push(
    "注: avg_st / ability_index / F・L回数 / コース別成績 / 全国・当地3連率 は raw_json boats[] に存在しない。",
  );
  lines.push(
    `注: boats[] 欠落 program は全体で ${report.rawJsonMissingBoats.total} 件（うち 2026年 ${report.rawJsonMissingBoats.in_2026} 件）。年別サンプルの欠落はこのクラスタを引いたもの。`,
  );
  lines.push("");

  lines.push("## 3. スナップショットテーブルの状態");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.snapshotMeta, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("### 全登録選手（スナップショット自体の充足率）");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.allRegistered, null, 2));
  lines.push("```");
  lines.push("");

  lines.push("## 4. 母集団別 coverage");
  lines.push("");
  lines.push(
    "| 母集団 | races | boats | className | 全国勝率 | 当地勝率 | motor2率 | boat2率 | profiles取得済 | course stats行 | venue motor2率 |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const pop of report.populations) {
    lines.push(
      `| ${pop.population} | ${pop.races} | ${pop.boats} | ${fmtPct(pop.programFieldCoverage.className.pct)} | ${fmtPct(pop.programFieldCoverage.nationalWinRate.pct)} | ${fmtPct(pop.programFieldCoverage.localWinRate.pct)} | ${fmtPct(pop.programFieldCoverage.motorTop2Rate.pct)} | ${fmtPct(pop.programFieldCoverage.boatTop2Rate.pct)} | ${fmtPct(pop.snapshotCoverage.inRacerProfilesReal.pct)} | ${fmtPct(pop.snapshotCoverage.courseStatsRow.pct)} | ${fmtPct(pop.motorBoatStats.motorTop2Rate.pct)} |`,
    );
  }
  lines.push("");
  for (const pop of report.populations) {
    lines.push(`### ${pop.population} — ${pop.description}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify({ snapshotCoverage: pop.snapshotCoverage, motorBoatStats: pop.motorBoatStats }, null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push("## 5. exacta forward monitor 固定6候補の coverage（条件は変更しない）");
  lines.push("");
  lines.push("| 候補 | 期間 | matched | 1号艇 class | 1号艇 全国勝率 | 1号艇 courseAvgSt | 2着艇 class | 2着艇 courseTop3 | motor2率 |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const cand of report.candidateCoverage) {
    for (const [period, cov] of [["forward", cand.forward], ["pre-lock参考", cand.preLockReference]] as const) {
      lines.push(
        `| ${cand.label} | ${period} | ${cov.matchedRaces} | ${fmtPct(cov.firstBoat.className.pct)} | ${fmtPct(cov.firstBoat.nationalWinRate.pct)} | ${fmtPct(cov.firstBoat.courseAvgSt.pct)} | ${fmtPct(cov.secondBoat.className.pct)} | ${fmtPct(cov.secondBoat.courseTop3Rate.pct)} | ${fmtPct(cov.motorBoatStats.motorTop2Rate.pct)} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    "注: forward は lockedAt 以降の monitor 母集団と同一クエリ。まだ 0 件の候補は forward レース未蓄積のため。" +
      "pre-lock参考 は lock 前の同条件母集団での coverage（将来分析の準備であり、ROI評価・買い条件作成はしない）。",
  );
  lines.push(
    "注: courseAvgSt / courseTop3Rate は現在値スナップショット由来のため、pre-lock 期間に対しては時点不整合（リーク）であり分析には使わないこと。",
  );
  lines.push("");

  lines.push("## 6. point-in-time 監査");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.pointInTime, null, 2));
  lines.push("```");
  lines.push("");

  lines.push("## 7. 安全分類");
  lines.push("");
  lines.push("| 特徴量 | ソース | 分類 | 備考 |");
  lines.push("|---|---|---|---|");
  for (const row of report.safetyClassification) {
    lines.push(`| ${row.feature} | ${row.source} | ${row.classifications.join(", ")} | ${row.notes} |`);
  }
  lines.push("");

  lines.push("## 8. まとめ");
  lines.push("");
  lines.push("- **今すぐ historical に使える**: className / nationalWinRate / nationalTop2Rate / localWinRate / localTop2Rate / motorTop2Rate / boatTop2Rate（raw_json 時点データ）、motor_boat_stats（2024以降）");
  lines.push("- **live-only なら使える**: avg_st / ability_index / flying_count / late_start_count / コース別成績（現在値スナップショットのみ）");
  lines.push("- **historical 検証には危険**: racer_profiles / racer_course_stats 全カラム、exhibitionStResidual（基準が現在値）");
  lines.push("- **coverage 不足**: motor_boat_stats 2024年以前、全国・当地3連率（データ自体が存在しない）");
  lines.push("- **schema 変更が必要**: 期別スナップショット（racer_ability_snapshots / racer_course_stats_snapshots）");
  lines.push("- **現在 decision で使用中**: className / nationalWinRate / localWinRate / motor・boatTop2Rate / courseAvgSt / courseTop3Rate / exhibitionStResidual");
  lines.push("- **未使用だが将来価値あり**: nationalTop2Rate / localTop2Rate / ability_index / F・L回数 / courseEntryRate / courseStartOrder");
  lines.push("- **次の最小ステップ**: docs/racer-point-in-time-feature-plan.md のスナップショット設計に従い、live取得時の世代保存を始める（BUY条件追加・ROI探索はしない）");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// renderMarkdown の引数型を main の report と一致させるためのダミー
function buildReportType() {
  return null as unknown as {
    generatedAt: string;
    dbPath: string;
    warning: string;
    schemaInventory: Record<string, Array<{ name: string; type: string; notNull: boolean }>>;
    rawJsonKeySurvey: Array<{ year: string; sampled: number; boatsPresent: number; keyPresence: Record<string, number> }>;
    rawJsonMissingBoats: { total: number; in_2026: number };
    snapshotMeta: Record<string, unknown>;
    allRegistered: Record<string, unknown>;
    populations: PopulationCoverage[];
    candidateCoverage: Array<{
      id: string;
      label: string;
      combo: string;
      forward: {
        matchedRaces: number;
        firstBoat: ReturnType<typeof coverageForBoatsOfCourse>;
        secondBoat: ReturnType<typeof coverageForBoatsOfCourse>;
        motorBoatStats: ReturnType<typeof motorBoatCoverageForCourses>;
      };
      preLockReference: {
        matchedRaces: number;
        firstBoat: ReturnType<typeof coverageForBoatsOfCourse>;
        secondBoat: ReturnType<typeof coverageForBoatsOfCourse>;
        motorBoatStats: ReturnType<typeof motorBoatCoverageForCourses>;
      };
    }>;
    pointInTime: ReturnType<typeof auditPointInTime>;
    safetyClassification: ReturnType<typeof buildSafetyClassification>;
  };
}
