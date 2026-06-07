import { DatabaseSync } from "node:sqlite";
import type { LabRow } from "./types.js";
import { parseSelection } from "./bet-selector.js";

export function loadRows(db: DatabaseSync): LabRow[] {
  const base = db.prepare(`
    SELECT dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, dh.result, dh.current_odds,
           dh.estimated_hit_rate, dh.conservative_hit_rate, dh.selection_popularity,
           rw.wind_speed_mps, rw.wave_height_cm, rw.weather,
           mbs.motor_top2_rate, mbs.boat_top2_rate
    FROM decision_history dh
    LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
    LEFT JOIN motor_boat_stats mbs ON mbs.race_id = dh.race_id AND mbs.course = CAST(substr(dh.selection, 1, 1) AS INTEGER)
    WHERE dh.run_kind='historical-backfill' AND dh.decision='BUY' AND dh.current_odds IS NOT NULL AND dh.result IS NOT NULL
    ORDER BY dh.date, dh.id
  `).all() as Array<Record<string, unknown>>;
  const raceIds = unique(base.map((row) => String(row.race_id)));
  const exhibition = loadExhibition(db, raceIds);
  const flying = loadFlying(db, raceIds);
  const parts = loadParts(db, raceIds);
  return base.map((row) => {
    const raceId = String(row.race_id);
    const selection = String(row.selection);
    const result = String(row.result);
    const boats = parseSelection(selection);
    const head = boats[0];
    const confidence = nullableNumber(row.conservative_hit_rate) ?? nullableNumber(row.estimated_hit_rate);
    const odds = Number(row.current_odds);
    const headEx = exhibition.get(`${raceId}:${head}`) ?? { rank: null, st: null };
    const selectedRanks = boats.map((boat) => exhibition.get(`${raceId}:${boat}`)?.rank).filter(isNumber);
    return {
      id: Number(row.id),
      raceId,
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection,
      result,
      boats,
      resultBoats: parseSelection(result),
      odds,
      hit: result === selection,
      confidence,
      edge: confidence == null ? null : confidence * odds - 1,
      popularity: nullableNumber(row.selection_popularity),
      wind: nullableNumber(row.wind_speed_mps),
      wave: nullableNumber(row.wave_height_cm),
      weatherPresent: row.weather != null || row.wind_speed_mps != null || row.wave_height_cm != null,
      headMotor: nullableNumber(row.motor_top2_rate),
      headBoat: nullableNumber(row.boat_top2_rate),
      headExRank: headEx.rank,
      headExSt: headEx.st,
      raceFCount: flying.race.get(raceId) ?? 0,
      headF: flying.boat.get(`${raceId}:${head}`) ?? 0,
      selectedF: boats.reduce((sum, boat) => sum + ((flying.boat.get(`${raceId}:${boat}`) ?? 0) > 0 ? 1 : 0), 0),
      selectedParts: boats.reduce((sum, boat) => sum + ((parts.get(`${raceId}:${boat}`) ?? 0) > 0 ? 1 : 0), 0),
      selectedExRankSpread: selectedRanks.length >= 3 ? Math.max(...selectedRanks) - Math.min(...selectedRanks) : null,
      selectedExTop3Overlap: selectedRanks.filter((rank) => rank <= 3).length,
    };
  }).filter((row) => row.boats.length === 3 && row.resultBoats.length === 3);
}

export function loadOdds(db: DatabaseSync, raceIds: string[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  if (!tableExists(db, "odds_snapshots")) return map;
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      WITH ranked AS (
        SELECT race_id, selection, odds,
               ROW_NUMBER() OVER (PARTITION BY race_id, selection ORDER BY is_final_like DESC, captured_at DESC, id DESC) AS rn
        FROM odds_snapshots
        WHERE race_id IN (${placeholders})
      )
      SELECT race_id, selection, odds FROM ranked WHERE rn = 1
    `).all(...ids) as Array<{ race_id: string; selection: string; odds: number }>;
    for (const row of rows) {
      const raceMap = map.get(row.race_id) ?? new Map<string, number>();
      raceMap.set(row.selection, Number(row.odds));
      map.set(row.race_id, raceMap);
    }
  }
  return map;
}

function loadExhibition(db: DatabaseSync, raceIds: string[]) {
  const map = new Map<string, { rank: number | null; st: number | null }>();
  if (!tableExists(db, "exhibition_data")) return map;
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT race_id, course, exhibition_time, ranking, start_timing FROM exhibition_data WHERE race_id IN (${placeholders})`).all(...ids) as Array<Record<string, unknown>>;
    const byRace = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) byRace.set(String(row.race_id), [...(byRace.get(String(row.race_id)) ?? []), row]);
    for (const [raceId, raceRows] of byRace) {
      const ranked = raceRows.filter((row) => row.exhibition_time != null).sort((a, b) => Number(a.exhibition_time) - Number(b.exhibition_time));
      for (const row of raceRows) {
        const course = Number(row.course);
        const derived = ranked.findIndex((candidate) => Number(candidate.course) === course);
        map.set(`${raceId}:${course}`, {
          rank: nullableNumber(row.ranking) ?? (derived >= 0 ? derived + 1 : null),
          st: nullableNumber(row.start_timing),
        });
      }
    }
  }
  return map;
}

function loadFlying(db: DatabaseSync, raceIds: string[]) {
  const race = new Map<string, number>();
  const boat = new Map<string, number>();
  if (!tableExists(db, "race_entries") || !tableExists(db, "racer_profiles")) return { race, boat };
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT ent.race_id, ent.boat, rp.flying_count
      FROM race_entries ent
      LEFT JOIN racer_profiles rp ON rp.registration_no = ent.racer_reg
      WHERE ent.race_id IN (${placeholders})
    `).all(...ids) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const raceId = String(row.race_id);
      const count = Number(row.flying_count ?? 0);
      if (count > 0) race.set(raceId, (race.get(raceId) ?? 0) + 1);
      boat.set(`${raceId}:${Number(row.boat)}`, count);
    }
  }
  return { race, boat };
}

function loadParts(db: DatabaseSync, raceIds: string[]) {
  const map = new Map<string, number>();
  if (!tableExists(db, "race_equipment")) return map;
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT race_id, course, parts_changed_count FROM race_equipment WHERE race_id IN (${placeholders})`).all(...ids) as Array<Record<string, unknown>>;
    for (const row of rows) map.set(`${String(row.race_id)}:${Number(row.course)}`, Number(row.parts_changed_count ?? 0));
  }
  return map;
}

function tableExists(db: DatabaseSync, table: string) {
  return Boolean((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name?: string } | undefined)?.name);
}
function nullableNumber(value: unknown): number | null { if (value == null || value === "") return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function isNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function chunks<T>(items: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
