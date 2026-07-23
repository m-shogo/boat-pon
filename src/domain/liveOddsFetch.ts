export type RaceIdentity = { raceId: string };

/** 同一レースの全候補を、オッズHTML取得1回分へ集約する。 */
export function uniqueRaceRows<T extends { candidate: RaceIdentity }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (seen.has(row.candidate.raceId)) return false;
    seen.add(row.candidate.raceId);
    return true;
  });
}

/** 取得窓内のレースを締切が近い順に処理し、T-5取り逃しを減らす。 */
export function prioritizeRaceRows<T extends { candidate: RaceIdentity }>(
  rows: T[],
  minutesUntilClose: (row: T) => number,
): T[] {
  return uniqueRaceRows(rows).sort((a, b) => minutesUntilClose(a) - minutesUntilClose(b));
}

/** 収集対象をモデル候補の有無から独立させ、公式番組の全raceを必ず1件ずつ残す。 */
export function alignRaceRowsToPrograms<
  P extends RaceIdentity,
  R extends { candidate: RaceIdentity },
  F extends { candidate: RaceIdentity },
>(
  programs: P[],
  rows: R[],
  fallback: (program: P) => F,
): Array<R | F> {
  const byRaceId = new Map(uniqueRaceRows(rows).map((row) => [row.candidate.raceId, row]));
  return programs.map((program) => byRaceId.get(program.raceId) ?? fallback(program));
}

export function isCompleteTrifectaCheckpoint(selectionCount: number, expected = 120) {
  return Number.isFinite(selectionCount) && selectionCount >= expected;
}

/** 入力順に仕事を払い出しつつ、同時実行数を上限内へ抑える。 */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export function isScheduledCollectionHour(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? -1);
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? -1);
  return hour >= 8 && (hour < 21 || (hour === 21 && minute <= 5));
}
