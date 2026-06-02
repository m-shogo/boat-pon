/**
 * 過去レースの公式直前情報（展示タイム・ST・チルト・部品交換・天候）をバックフィルする。
 *
 * 対象: decision_history の BUY/WATCH レースのみ。全レースは対象外。
 * 取得元: https://www.boatrace.jp/owpc/pc/race/beforeinfo
 * 保存: race_weather / exhibition_data / race_equipment に source_type='official_historical' で保存。
 *
 * skip条件: 3テーブル全てに source_type='official_historical' があるraceはスキップ。
 *           どれか1つでも欠けていればリトライ対象。
 *
 * usage:
 *   tsx scripts/backfill-beforeinfo.ts [--dry-run] --from YYYY-MM-DD --to YYYY-MM-DD [--decisions BUY,WATCH] [--interval-ms N] [--limit N]
 *
 * 例:
 *   tsx scripts/backfill-beforeinfo.ts --dry-run --from 2025-01-01 --to 2025-01-07
 *   tsx scripts/backfill-beforeinfo.ts --from 2025-01-01 --to 2025-01-07
 */

import { openDb, upsertExhibitionData, upsertRaceEquipment, upsertRaceWeather } from "../server/db";
import { parseBeforeInfoHtml } from "../src/domain/beforeInfoParser";

const SOURCE_TYPE = "official_historical";
const SOURCE_QUALITY = "exact";
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_DECISIONS = ["BUY", "WATCH"];

const venueCodes: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

type RaceTarget = { race_id: string; date: string; venue: string; race_no: number };
type FetchStatus = "fetched" | "skipped" | "partial_skip" | "no_exh" | "failed" | "dry_run";

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** 3テーブル全て official_historical で揃っているか確認 */
function isFullyBackfilled(db: ReturnType<typeof openDb>, raceId: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM exhibition_data e
    WHERE e.race_id = ?
      AND e.source_type = 'official_historical'
      AND EXISTS (
        SELECT 1 FROM race_weather w
        WHERE w.race_id = e.race_id AND w.source_type = 'official_historical'
      )
      AND EXISTS (
        SELECT 1 FROM race_equipment q
        WHERE q.race_id = e.race_id AND q.source_type = 'official_historical'
      )
    LIMIT 1
  `).get(raceId);
  return row != null;
}

/** どのテーブルが欠けているかを返す（retry用） */
function missingTables(db: ReturnType<typeof openDb>, raceId: string): string[] {
  const missing: string[] = [];
  const hasExh = db.prepare(`SELECT 1 FROM exhibition_data WHERE race_id = ? AND source_type = 'official_historical' LIMIT 1`).get(raceId);
  const hasWeather = db.prepare(`SELECT 1 FROM race_weather WHERE race_id = ? AND source_type = 'official_historical' LIMIT 1`).get(raceId);
  const hasEquip = db.prepare(`SELECT 1 FROM race_equipment WHERE race_id = ? AND source_type = 'official_historical' LIMIT 1`).get(raceId);
  if (!hasExh) missing.push("exhibition_data");
  if (!hasWeather) missing.push("race_weather");
  if (!hasEquip) missing.push("race_equipment");
  return missing;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fromDate = argValue("--from");
  const toDate = argValue("--to");
  const limitArg = argValue("--limit");
  const decisionsArg = argValue("--decisions");
  const intervalArg = argValue("--interval-ms");

  if (!fromDate || !toDate) {
    console.error("usage: tsx scripts/backfill-beforeinfo.ts [--dry-run] --from YYYY-MM-DD --to YYYY-MM-DD");
    process.exit(1);
  }

  const decisions = decisionsArg ? decisionsArg.split(",") : DEFAULT_DECISIONS;
  const intervalMs = intervalArg ? Number(intervalArg) : DEFAULT_INTERVAL_MS;
  const limit = limitArg ? Number(limitArg) : null;

  const db = openDb();
  try {
    // 対象race_idを決定履歴から取得 (重複なし)
    const placeholders = decisions.map(() => "?").join(",");
    const allTargets = db.prepare(`
      SELECT DISTINCT race_id, date, venue, race_no
      FROM decision_history
      WHERE run_kind = 'historical-backfill'
        AND decision IN (${placeholders})
        AND date BETWEEN ? AND ?
      ORDER BY date, venue, race_no
    `).all(...decisions, fromDate, toDate) as RaceTarget[];

    // 3テーブル全て揃っているものをスキップ
    const targets = allTargets.filter((r) => !isFullyBackfilled(db, r.race_id));
    const skippedCount = allTargets.length - targets.length;
    const partialTargets = targets.filter((r) => missingTables(db, r.race_id).length < 3);

    const limited = limit ? targets.slice(0, limit) : targets;

    // --- dry-run サマリー ---
    console.log("=== backfill-beforeinfo dry-run ===" + (dryRun ? "" : " (本番モード)"));
    console.log(`期間: ${fromDate} 〜 ${toDate}`);
    console.log(`対象決定種別: ${decisions.join(", ")}`);
    console.log(`取得間隔: ${intervalMs / 1000}秒`);
    console.log("");
    console.log(`decision_history 合計対象: ${allTargets.length} races`);
    console.log(`  既取得済み (3テーブル全揃い): ${skippedCount} races → スキップ`);
    console.log(`  部分取得 (1-2テーブル欠け): ${partialTargets.length} races → リトライ`);
    console.log(`  未取得: ${targets.length - partialTargets.length} races`);
    console.log(`  今回の取得対象 (limit=${limit ?? "なし"}): ${limited.length} races`);
    console.log("");

    const estSeconds15 = limited.length * 15;
    const estSeconds30 = limited.length * 30;
    console.log(`推定アクセス数: ${limited.length} HTTPリクエスト`);
    console.log(`推定時間 (15秒間隔): ${Math.ceil(estSeconds15 / 60)} 分 (${(estSeconds15 / 3600).toFixed(1)} 時間)`);
    console.log(`推定時間 (30秒間隔): ${Math.ceil(estSeconds30 / 60)} 分 (${(estSeconds30 / 3600).toFixed(1)} 時間)`);
    console.log("");

    const estExhRows = limited.length * 6;
    const estEquipRows = limited.length * 6;
    const estWeatherRows = limited.length;
    console.log(`予定書き込み件数:`);
    console.log(`  exhibition_data: 最大 ${estExhRows} 行 (6コース×${limited.length}レース)`);
    console.log(`  race_equipment:  最大 ${estEquipRows} 行`);
    console.log(`  race_weather:    最大 ${estWeatherRows} 行`);
    console.log("");

    if (limited.length > 0) {
      console.log("取得対象サンプル (最初10件):");
      for (const r of limited.slice(0, 10)) {
        const missing = missingTables(db, r.race_id);
        const status = missing.length === 3 ? "未取得" : `部分(欠:${missing.join(",")})`;
        console.log(`  ${r.race_id} [${status}]`);
      }
    }

    if (dryRun) {
      console.log("\n--- dry-run 完了。--dry-run を外すと本番取得を開始します。---");
      return;
    }

    // --- 本番取得 ---
    console.log("\n--- 本番取得開始 ---");
    let fetched = 0;
    let failed = 0;
    let noExh = 0;

    for (let i = 0; i < limited.length; i++) {
      const target = limited[i];
      const { race_id: raceId, date, venue, race_no: raceNo } = target;
      const jcd = venueCodes[venue];
      if (!jcd) {
        log(`SKIP unknown venue: ${venue} (${raceId})`);
        failed++;
        continue;
      }

      const hd = date.replaceAll("-", "");
      const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${raceNo}&jcd=${jcd}&hd=${hd}`;

      try {
        const res = await fetch(url, {
          headers: { "user-agent": "BoatPon/0.1 personal low-frequency backfill" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const html = await res.text();
        const { exhibition, weather, equipment } = parseBeforeInfoHtml(html);
        const fetchedAt = new Date().toISOString();

        if (exhibition.length === 0) {
          log(`no-exh: ${raceId} (ページが空か公開終了の可能性)`);
          noExh++;
        } else {
          upsertExhibitionData(db, raceId, exhibition, fetchedAt, SOURCE_TYPE);
          if (weather) upsertRaceWeather(db, raceId, weather, fetchedAt, SOURCE_TYPE);
          upsertRaceEquipment(db, raceId, equipment, fetchedAt, SOURCE_TYPE);
          const stCount = exhibition.filter((e) => e.startTiming !== null).length;
          log(`OK [${i + 1}/${limited.length}] ${raceId}: exh=${exhibition.length} ST=${stCount} tilt=${equipment.length} weather=${!!weather} stablePlate=${weather?.stablePlate ?? "-"}`);
          fetched++;
        }
      } catch (err) {
        log(`FAIL ${raceId}: ${err instanceof Error ? err.message : err}`);
        failed++;
      }

      if (i < limited.length - 1) {
        await sleep(intervalMs);
      }
    }

    console.log("");
    console.log("=== 完了 ===");
    console.log(`取得成功: ${fetched} / 失敗: ${failed} / 展示なし: ${noExh}`);
    console.log(`source_type='${SOURCE_TYPE}', source_quality='${SOURCE_QUALITY}' で保存済み`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
