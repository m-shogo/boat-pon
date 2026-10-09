/**
 * 公式の直前情報（展示・天候・部品交換）を1レース分取って保存する共通処理。
 * auto-fetch-exhibition（30分おきの一括取得）と auto-fetch-odds（締切前で直前情報が無いレースだけをその場で取得）から使う。
 */
import type { DatabaseSync } from "node:sqlite";
import { upsertExhibitionData, upsertRaceEquipment, upsertRaceWeather } from "../../server/db";
import { parseBeforeInfoHtml } from "../../src/domain/beforeInfoParser";
import { venueCodes } from "../fetch-official-odds";

export type BeforeInfoTarget = { raceId: string; date: string; venue: string; raceNo: number };

export type BeforeInfoResult =
  | { status: "saved"; entries: number; equipment: number; windSpeedMps: number | null; waveHeightCm: number | null }
  | { status: "empty" }
  | { status: "unknown-venue" };

const FETCH_TIMEOUT_MS = 20_000;

export async function fetchAndSaveBeforeInfo(db: DatabaseSync, target: BeforeInfoTarget): Promise<BeforeInfoResult> {
  const jcd = venueCodes[target.venue];
  if (!jcd) return { status: "unknown-venue" };
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${target.raceNo}&jcd=${jcd}&hd=${target.date.replaceAll("-", "")}`;
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency fetch" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const { exhibition: entries, weather, equipment } = parseBeforeInfoHtml(await res.text());
  if (entries.length === 0 && !weather && equipment.length === 0) return { status: "empty" };
  const fetchedAt = new Date().toISOString();
  upsertExhibitionData(db, target.raceId, entries, fetchedAt);
  if (weather) upsertRaceWeather(db, target.raceId, weather, fetchedAt);
  upsertRaceEquipment(db, target.raceId, equipment, fetchedAt);
  return { status: "saved", entries: entries.length, equipment: equipment.length, windSpeedMps: weather?.windSpeedMps ?? null, waveHeightCm: weather?.waveHeightCm ?? null };
}
