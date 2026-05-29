import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/boat.sqlite";
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  run(db);
} finally {
  db.close();
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "n/a";
  return ((num / denom) * 100).toFixed(1) + "%";
}

function run(db: DatabaseSync) {
  // ── racer_course_stats ──────────────────────────────────────────────────
  const cs = db.prepare(`
    SELECT
      COUNT(DISTINCT registration_no) AS racers,
      COUNT(*) AS rows,
      SUM(CASE WHEN top3_rate IS NOT NULL THEN 1 ELSE 0 END) AS has_top3_rate,
      SUM(CASE WHEN avg_st IS NOT NULL THEN 1 ELSE 0 END)    AS has_avg_st,
      SUM(CASE WHEN start_order IS NOT NULL THEN 1 ELSE 0 END) AS has_start_order,
      SUM(CASE WHEN entry_rate IS NOT NULL THEN 1 ELSE 0 END) AS has_entry_rate
    FROM racer_course_stats
  `).get() as Record<string, number>;

  // ── racer_profiles ──────────────────────────────────────────────────────
  // "real" = flying_count が non-null（バルク取得が完了した行）
  const rp = db.prepare(`
    SELECT
      COUNT(*) AS total_rows,
      SUM(CASE WHEN flying_count IS NOT NULL THEN 1 ELSE 0 END) AS real_rows,
      SUM(CASE WHEN flying_count > 0 THEN 1 ELSE 0 END) AS has_flying,
      SUM(CASE WHEN late_start_count > 0 THEN 1 ELSE 0 END) AS has_late,
      SUM(CASE WHEN avg_st IS NOT NULL THEN 1 ELSE 0 END) AS has_avg_st,
      SUM(CASE WHEN ability_index IS NOT NULL THEN 1 ELSE 0 END) AS has_ability
    FROM racer_profiles
  `).get() as Record<string, number>;

  // ── 今日の番組 ───────────────────────────────────────────────────────────
  const latestRow = db.prepare(`SELECT MAX(date) AS d FROM official_programs`).get() as { d: string };
  const today = latestRow.d;

  const todayRacerRows = db.prepare(`
    SELECT DISTINCT json_extract(boat.value, '$.registrationNo') AS reg
    FROM official_programs, json_each(json_extract(raw_json, '$.boats')) AS boat
    WHERE date = ?
      AND json_extract(boat.value, '$.registrationNo') IS NOT NULL
  `).all(today) as Array<{ reg: string }>;
  const todayRegs = new Set(todayRacerRows.map((r) => r.reg));

  const todayCourseHit = db.prepare(`
    SELECT COUNT(DISTINCT registration_no) AS cnt
    FROM racer_course_stats
    WHERE registration_no IN (
      SELECT DISTINCT json_extract(boat.value, '$.registrationNo')
      FROM official_programs, json_each(json_extract(raw_json, '$.boats')) AS boat
      WHERE date = ?
        AND json_extract(boat.value, '$.registrationNo') IS NOT NULL
    )
  `).get(today) as { cnt: number };

  const todayProfileHit = db.prepare(`
    SELECT COUNT(DISTINCT registration_no) AS cnt
    FROM racer_profiles
    WHERE flying_count IS NOT NULL
      AND registration_no IN (
        SELECT DISTINCT json_extract(boat.value, '$.registrationNo')
        FROM official_programs, json_each(json_extract(raw_json, '$.boats')) AS boat
        WHERE date = ?
          AND json_extract(boat.value, '$.registrationNo') IS NOT NULL
      )
  `).get(today) as { cnt: number };

  // ── BUY候補（今日分） ────────────────────────────────────────────────────
  const buyRows = db.prepare(`
    SELECT race_id, selection FROM decision_history
    WHERE date = ? AND decision = 'BUY'
  `).all(today) as Array<{ race_id: string; selection: string }>;

  // selection "A-B-C" → 1着艇番 A の registrationNo を official_programs から取得
  const buyRegs = new Set<string>();
  for (const { race_id, selection } of buyRows) {
    const firstBoatNo = parseInt(selection.split("-")[0], 10);
    if (!firstBoatNo) continue;
    const prog = db.prepare(`SELECT raw_json FROM official_programs WHERE race_id = ? LIMIT 1`).get(race_id) as
      | { raw_json: string }
      | undefined;
    if (!prog) continue;
    const json = JSON.parse(prog.raw_json) as { boats: Array<{ course: number; registrationNo: string }> };
    const boat = json.boats.find((b) => b.course === firstBoatNo);
    if (boat?.registrationNo) buyRegs.add(boat.registrationNo);
  }

  const buyTotal = buyRegs.size;
  const buyCourseHit = [...buyRegs].filter((reg) =>
    (db.prepare(`SELECT 1 FROM racer_course_stats WHERE registration_no = ?`).get(reg)) != null
  ).length;
  const buyProfileHit = [...buyRegs].filter((reg) =>
    (db.prepare(`SELECT 1 FROM racer_profiles WHERE registration_no = ? AND flying_count IS NOT NULL`).get(reg)) != null
  ).length;

  // ── 出力 ────────────────────────────────────────────────────────────────
  console.log("\n=== Racer Stats Coverage ===\n");

  console.log("■ racer_course_stats");
  console.log(`  登録選手     : ${cs.racers} 人`);
  console.log(`  総行数       : ${cs.rows} 行（6コース×${cs.racers}人 = ${cs.racers * 6} 行のはず）`);
  console.log(`  3連対率あり  : ${cs.has_top3_rate} / ${cs.rows}  (${pct(cs.has_top3_rate, cs.rows)})`);
  console.log(`  平均STあり   : ${cs.has_avg_st} / ${cs.rows}  (${pct(cs.has_avg_st, cs.rows)})`);
  console.log(`  スタート順あり: ${cs.has_start_order} / ${cs.rows}  (${pct(cs.has_start_order, cs.rows)})`);
  console.log(`  進入率あり   : ${cs.has_entry_rate} / ${cs.rows}  (${pct(cs.has_entry_rate, cs.rows)})`);

  console.log("\n■ racer_profiles");
  console.log(`  DB行数(全)   : ${rp.total_rows} 行`);
  console.log(`  取得済み     : ${rp.real_rows} 人（期別成績あり）`);
  console.log(`  F持ち        : ${rp.has_flying} 人`);
  console.log(`  L持ち        : ${rp.has_late} 人`);
  console.log(`  平均STあり   : ${rp.has_avg_st} 人 / ${rp.real_rows} 取得済み`);
  console.log(`  能力指数あり : ${rp.has_ability} 人 / ${rp.real_rows} 取得済み`);

  console.log(`\n■ 今日の番組 (${today})`);
  console.log(`  出走選手     : ${todayRegs.size} 人`);
  console.log(`  コース別あり : ${todayCourseHit.cnt} 人  (${pct(todayCourseHit.cnt, todayRegs.size)})`);
  console.log(`  プロフィールあり: ${todayProfileHit.cnt} 人  (${pct(todayProfileHit.cnt, todayRegs.size)})`);

  console.log(`\n■ BUY候補 (${today})`);
  if (buyRows.length === 0) {
    console.log("  BUY候補なし");
  } else {
    console.log(`  BUYレース数  : ${buyRows.length}`);
    console.log(`  1号艇選手数  : ${buyTotal} 人`);
    console.log(`  コース別あり : ${buyCourseHit} / ${buyTotal}  (${pct(buyCourseHit, buyTotal)})`);
    console.log(`  プロフィールあり: ${buyProfileHit} / ${buyTotal}  (${pct(buyProfileHit, buyTotal)})`);
    console.log("  詳細:");
    for (const { race_id, selection } of buyRows) {
      const firstBoatNo = parseInt(selection.split("-")[0], 10);
      const prog = db.prepare(`SELECT raw_json FROM official_programs WHERE race_id = ? LIMIT 1`).get(race_id) as
        | { raw_json: string }
        | undefined;
      if (!prog) continue;
      const json = JSON.parse(prog.raw_json) as { boats: Array<{ course: number; registrationNo: string; racerName: string }> };
      const boat = json.boats.find((b) => b.course === firstBoatNo);
      const hasCourse = boat && (db.prepare(`SELECT 1 FROM racer_course_stats WHERE registration_no = ?`).get(boat.registrationNo)) != null;
      const hasProfile = boat && (db.prepare(`SELECT 1 FROM racer_profiles WHERE registration_no = ? AND flying_count IS NOT NULL`).get(boat.registrationNo)) != null;
      const markers = [hasCourse ? "コース別○" : "コース別✗", hasProfile ? "profile○" : "profile✗"];
      console.log(`    ${race_id}  ${selection}  ${boat?.racerName ?? "?"} (${boat?.registrationNo ?? "?"})  ${markers.join(" ")}`);
    }
  }

  console.log("");
}
