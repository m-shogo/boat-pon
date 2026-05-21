import type { BacktestSummary, DecisionHistoryRow } from "./domain/backtest";
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
  backtest: BacktestSummary;
};

export type NotificationRecord = {
  id: number;
  raceId: string;
  channel: "browser" | "discord" | "none";
  status: "PENDING" | "SENT" | "SUPPRESSED";
  title: string;
  body: string;
  officialUrl: string;
  createdAt: string;
  sentAt: string | null;
};

export async function getDashboard(): Promise<DashboardResponse> {
  const res = await fetch("/api/dashboard");
  if (!res.ok) throw new Error(`dashboard api failed: ${res.status}`);
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

export async function sendBrowserNotification(id: number): Promise<NotificationRecord> {
  const res = await fetch(`/api/notifications/${id}/send`, { method: "POST" });
  if (!res.ok) throw new Error(`notification api failed: ${res.status}`);
  return res.json();
}

export type { BacktestSummary, DecisionHistoryRow };
