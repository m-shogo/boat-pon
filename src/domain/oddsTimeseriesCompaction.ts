export type OddsCaptureSummary = {
  raceId: string;
  checkpointLabel: string | null;
  capturedAt: string;
  minutesBeforeClose: number | null;
  rowCount: number;
  selectionCount: number;
};

/**
 * 各race/checkpointについて、目標時点に最も近い完全120通りと最新取得を保持する。
 * 同じcaptureなら1件だけ。完全取得が無いgroupは最新取得だけを残す。
 */
export function selectRetainedCaptures(captures: OddsCaptureSummary[]): OddsCaptureSummary[] {
  const groups = new Map<string, OddsCaptureSummary[]>();
  for (const capture of captures) {
    const key = `${capture.raceId}/${capture.checkpointLabel ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), capture]);
  }

  const retained: OddsCaptureSummary[] = [];
  for (const group of groups.values()) {
    const latest = [...group].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    const complete = group
      .filter((capture) => capture.selectionCount >= 120)
      .sort((a, b) => compareCanonical(a, b))[0];
    if (complete) retained.push(complete);
    if (!complete || latest.capturedAt !== complete.capturedAt) retained.push(latest);
  }
  return retained;
}

function compareCanonical(a: OddsCaptureSummary, b: OddsCaptureSummary) {
  const target = checkpointTargetMinutes(a.checkpointLabel);
  const aDistance = a.minutesBeforeClose == null ? Number.POSITIVE_INFINITY : Math.abs(a.minutesBeforeClose - target);
  const bDistance = b.minutesBeforeClose == null ? Number.POSITIVE_INFINITY : Math.abs(b.minutesBeforeClose - target);
  if (aDistance !== bDistance) return aDistance - bDistance;
  return b.capturedAt.localeCompare(a.capturedAt);
}

export function checkpointTargetMinutes(label: string | null) {
  if (label === "T-30") return 30;
  if (label === "T-20") return 20;
  if (label === "T-10") return 12;
  if (label === "T-5") return 5;
  return 0;
}
