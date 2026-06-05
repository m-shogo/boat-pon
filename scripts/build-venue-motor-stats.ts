/**
 * 会場×モーター番号の実績 top2 率を race_results から計算し
 * motor_boat_stats テーブルの motor_top2_rate を更新する。
 *
 * 現在の motor_boat_stats は official_programs の全国平均をコピーしたもの。
 * このスクリプトは直近180日の会場実績で上書きし、モデル精度を向上させる。
 *
 * usage:
 *   tsx scripts/build-venue-motor-stats.ts [--dry-run] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */

import { openDb } from "../server/db";

const LOOKBACK_DAYS = 180;
const MIN_RACES = 5;

function argValue(name: string): string | null {
  const eq = process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
  if (eq) return eq;
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function log(msg: string) { console.log(`[build-venue-motor-stats] ${msg}`); }

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const from = argValue("--from") ?? "2024-01-01";
  const to = argValue("--to") ?? new Date(Date.now() + 9*3600000).toISOString().slice(0, 10);

  log(`range: ${from}〜${to}  lookback=${LOOKBACK_DAYS}d  min=${MIN_RACES}  dry-run=${dryRun}`);

  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT mbs.race_id, mbs.date, mbs.venue, mbs.course, mbs.motor_no,
             mbs.motor_top2_rate AS orig_rate
      FROM motor_boat_stats mbs
      WHERE mbs.date BETWEEN ? AND ? AND mbs.motor_no IS NOT NULL
      ORDER BY mbs.date, mbs.race_id, mbs.course
    `).all(from, to) as Array<{ race_id: string; date: string; venue: string; course: number; motor_no: string; orig_rate: number | null }>;

    log(`target rows: ${rows.length}`);

    // 会場別モーター実績をバッチ計算（venue×motor_no×date）
    // パフォーマンスのため、会場ごとにまとめて事前計算
    type MotorKey = string; // `${venue}|${motor_no}|${date}`
    const cache = new Map<MotorKey, number | null>();

    const statsQuery = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN CAST(substr(rr.trifecta,1,1) AS INTEGER)=mbs2.course
          OR CAST(substr(rr.trifecta,3,1) AS INTEGER)=mbs2.course THEN 1 ELSE 0 END) AS top2s
      FROM motor_boat_stats mbs2
      JOIN race_results rr ON rr.race_id=mbs2.race_id AND rr.returned=0 AND rr.trifecta IS NOT NULL
      WHERE mbs2.venue=? AND mbs2.motor_no=? AND mbs2.date >= ? AND mbs2.date < ?
    `);

    const updateStmt = dryRun ? null : db.prepare(
      `UPDATE motor_boat_stats SET motor_top2_rate=? WHERE race_id=? AND course=?`
    );

    let updated = 0, unchanged = 0, insufficient = 0;
    const sampleLogs: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lookbackDate = new Date(`${row.date}T00:00:00Z`);
      lookbackDate.setUTCDate(lookbackDate.getUTCDate() - LOOKBACK_DAYS);
      const lookbackStr = lookbackDate.toISOString().slice(0, 10);

      const cacheKey = `${row.venue}|${row.motor_no}|${row.date}`;
      let computedRate: number | null;

      if (cache.has(cacheKey)) {
        computedRate = cache.get(cacheKey)!;
      } else {
        const stat = statsQuery.get(row.venue, row.motor_no, lookbackStr, row.date) as { total: number; top2s: number };
        computedRate = (stat && stat.total >= MIN_RACES)
          ? Math.round(stat.top2s / stat.total * 10000) / 100
          : null;
        cache.set(cacheKey, computedRate);
      }

      if (computedRate === null) {
        insufficient++;
      } else if (Math.abs(computedRate - (row.orig_rate ?? 0)) > 0.5) {
        if (!dryRun) updateStmt!.run(computedRate, row.race_id, row.course);
        if (sampleLogs.length < 5) {
          sampleLogs.push(`  ${row.race_id} c${row.course} motor=${row.motor_no}: ${row.orig_rate?.toFixed(1)}% → ${computedRate}%`);
        }
        updated++;
      } else {
        unchanged++;
      }

      if ((i + 1) % 50000 === 0) log(`  ${i + 1}/${rows.length}...`);
    }

    for (const s of sampleLogs) log(s);
    log(`done: updated=${updated} unchanged=${unchanged} insufficient=${insufficient} cache_size=${cache.size}`);
    if (dryRun) log("--- dry-run完了。--dry-runを外すと本番更新します ---");
  } finally {
    db.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
