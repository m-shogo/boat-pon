import type { BacktestSummary, DecisionHistoryRow, MonthlySummary } from "./domain/backtest";
import type { SavingsSummary } from "./domain/savings";
import type { VenueHeatmapSummary } from "./domain/venueHeatmap";
import type { RoiRow } from "./domain/segmentStats";
import type { ProgramStatSummary } from "./domain/programStats";
import type { BetCandidate, BudgetRule, Decision, RaceResult } from "./domain/types";

export type CandidateRow = {
  candidate: BetCandidate;
  decision: Decision;
  officialUrl: string;
};

export type DashboardResponse = {
  settings: BudgetRule;
  headline: string;
  headlineSub: string;
  rows: CandidateRow[];
  results: RaceResult[];
  notifications: NotificationRecord[];
  date: string | null;
  history: DecisionHistoryRow[];
  backtest: BacktestSummary;
  monthly: MonthlySummary;
  monthlyTrend: MonthlySummary[];
  savings: SavingsSummary;
  venueHeatmap: VenueHeatmapSummary;
  segmentStats: { byTimeBand: RoiRow[]; byRaceNo: RoiRow[] };
  programStats: ProgramStatSummary;
};

export type NotificationRecord = {
  id: number;
  raceId: string;
  channel: "browser" | "none";
  status: "PENDING" | "SENT" | "SUPPRESSED";
  title: string;
  body: string;
  officialUrl: string;
  createdAt: string;
  sentAt: string | null;
};

export async function getDashboard(date?: string): Promise<DashboardResponse> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await fetch(`/api/dashboard${qs}`);
  if (!res.ok) throw new Error(`dashboard api failed: ${res.status}`);
  return res.json();
}

export async function reparseKyotei24(date: string): Promise<{ normalizedPath: string; count: number }> {
  const res = await fetch("/api/import/reparse-kyotei24", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) throw new Error(`reparse api failed: ${res.status}`);
  return res.json();
}

export async function updatePurchaseRecord(id: number, actuallyBought: boolean, stakeYen: number): Promise<DecisionHistoryRow> {
  const res = await fetch(`/api/history/${id}/purchase`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actuallyBought, stakeYen }),
  });
  if (!res.ok) throw new Error(`purchase api failed: ${res.status}`);
  return res.json();
}

export async function importOfficialRows(rows: Array<Record<string, unknown>>, sourceFile = "manual-ui"): Promise<{ imported: number }> {
  const res = await fetch("/api/import/official-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows, sourceFile }),
  });
  if (!res.ok) throw new Error(`official import api failed: ${res.status}`);
  return res.json();
}

export async function updateSettings(settings: BudgetRule): Promise<BudgetRule> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`settings api failed: ${res.status}`);
  return res.json();
}

export async function updateManualOdds(raceId: string, odds: number): Promise<{ raceId: string; odds: number }> {
  const res = await fetch(`/api/odds/${raceId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ odds }),
  });
  if (!res.ok) throw new Error(`manual odds api failed: ${res.status}`);
  return res.json();
}

export type OddsFetchResult = {
  raceId: string;
  odds: number | null;
  status: "ok" | "ok-cached" | "out-of-window" | "parse-failed" | "error";
  error?: string;
};

export async function fetchOdds(raceIds?: string[]): Promise<{ results: OddsFetchResult[] }> {
  const res = await fetch("/api/odds/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raceIds }),
  });
  if (!res.ok) throw new Error(`odds fetch api failed: ${res.status}`);
  return res.json();
}

export async function sendBrowserNotification(id: number): Promise<NotificationRecord> {
  const res = await fetch(`/api/notifications/${id}/send`, { method: "POST" });
  if (!res.ok) throw new Error(`notification api failed: ${res.status}`);
  return res.json();
}

export async function fetchVapidPublicKey(): Promise<{ publicKey: string | null; enabled: boolean }> {
  const res = await fetch("/api/push/vapid-public-key");
  if (!res.ok) throw new Error(`vapid api failed: ${res.status}`);
  return res.json();
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<{ ok: boolean; enabled: boolean }> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription),
  });
  if (!res.ok) throw new Error(`subscribe api failed: ${res.status}`);
  return res.json();
}

export async function testPushBroadcast(): Promise<{ ok: boolean; sent?: number; failed?: number; error?: string }> {
  const res = await fetch("/api/push/test", { method: "POST" });
  return res.json();
}

export type { BacktestSummary, DecisionHistoryRow, MonthlySummary, SavingsSummary, VenueHeatmapSummary };
