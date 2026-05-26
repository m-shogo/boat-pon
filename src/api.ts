import type { BacktestSummary, DecisionHistoryRow, MonthlySummary } from "./domain/backtest";
import type { SavingsSummary } from "./domain/savings";
import type { VenueHeatmapSummary } from "./domain/venueHeatmap";
import type { RoiRow } from "./domain/segmentStats";
import type { ProgramStatSummary } from "./domain/programStats";
import type { CategoryStatSummary } from "./domain/categoryStats";
import type { RollingDriftSummary } from "./domain/rollingDrift";
import type { ModelVersionInfo } from "./domain/modelVersion";
import type { ModelComparisonRow } from "./domain/modelComparison";
import type { OddsSnapshot } from "./domain/oddsSnapshot";
import type { DecisionExplanation, SkipReasonSummary } from "./domain/decisionExplain";
import type { WalkForwardRow, WalkForwardSummary } from "./domain/walkForward";
import type { BetCandidate, BudgetRule, Decision, RaceResult } from "./domain/types";

export type CandidateRow = {
  candidate: BetCandidate;
  decision: Decision;
  officialUrl: string;
  explanation: DecisionExplanation;
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
  categoryStats: CategoryStatSummary;
  rollingDrift: RollingDriftSummary;
  modelVersion: ModelVersionInfo;
  skipReasons: SkipReasonSummary[];
  oddsSnapshots: OddsSnapshot[];
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

export async function getOddsSnapshots(raceId?: string): Promise<{ rows: OddsSnapshot[] }> {
  const qs = raceId ? `?raceId=${encodeURIComponent(raceId)}` : "";
  const res = await fetch(`/api/odds/snapshots${qs}`);
  if (!res.ok) throw new Error(`odds snapshots api failed: ${res.status}`);
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

export type WalkForwardResponse = {
  summary: WalkForwardSummary;
  rows: WalkForwardRow[];
};

export async function runWalkForwardApi(params: {
  from?: string;
  to?: string;
  minTrainRaceCount?: number;
  alpha?: number;
}): Promise<WalkForwardResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.minTrainRaceCount != null) qs.set("minTrainRaceCount", String(params.minTrainRaceCount));
  if (params.alpha != null) qs.set("alpha", String(params.alpha));
  const res = await fetch("/api/backtest/walk-forward?" + qs.toString());
  if (!res.ok) throw new Error(`walk-forward api failed: ${res.status}`);
  return res.json();
}

export async function compareModelsApi(params: {
  from?: string;
  to?: string;
}): Promise<{ rows: ModelComparisonRow[] }> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const res = await fetch("/api/backtest/model-comparison?" + qs.toString());
  if (!res.ok) throw new Error(`model comparison api failed: ${res.status}`);
  return res.json();
}

export type CalibrationRow = {
  req_band: string;
  cls: string;
  n: number;
  hits: number;
  avg_est_pct: number;
  actual_pct: number;
  calib_ratio: number;
  avg_odds: number;
  avg_req: number;
  max_hit_odds: number;
};

export type CalibrationExternalSummary = {
  n: number;
  roi: number;
  hits: number;
};

export type CalibrationReturnedStats = {
  total: number;
  returned: number;
  pct: number;
};

export type CalibrationCompareResponse = {
  mode: "compare";
  b1filter: boolean;
  external: { from: string; to: string; rows: CalibrationRow[]; summary: CalibrationExternalSummary | null };
  insample: { from: string; to: string; rows: CalibrationRow[] };
  insampleReturnedStats: CalibrationReturnedStats;
};

export type CalibrationCustomResponse = {
  mode: "custom";
  from: string;
  to: string;
  b1filter: boolean;
  rows: CalibrationRow[];
};

export async function fetchCalibrationApi(params: {
  from?: string;
  to?: string;
  b1filter?: boolean;
  mode?: "compare" | "custom";
}): Promise<CalibrationCompareResponse | CalibrationCustomResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.b1filter) qs.set("b1filter", "1");
  if (params.mode) qs.set("mode", params.mode);
  const res = await fetch("/api/backtest/calibration?" + qs.toString());
  if (!res.ok) throw new Error(`calibration api failed: ${res.status}`);
  return res.json();
}

export type LiveMonitorMonthly = {
  ym: string;
  n: number;
  hits: number;
  returned_n: number;
  roi: number | null;
  avg_odds: number;
  avg_ratio: number;
};

export type LiveMonitorDiagnostic = {
  model_version: string;
  source: string;
  n: number;
  latest_date: string | null;
};

export type LiveMonitorDecisionCount = {
  decision: string;
  n: number;
  latest_date: string | null;
};

export type LiveMonitorResponse = {
  period: { from: string; to: string; modelVersion: string; filter: string };
  summary: {
    n: number;
    hits: number;
    returnedN: number;
    roi: number | null;
    maxHitOdds: number;
    roiExMax: number | null;
    avgRequiredOdds: number | null;
    avgCurrentOdds: number | null;
    avgOddsRatio: number | null;
    estimatedHits: number | null;
  };
  milestoneStatus: "insufficient" | "watch" | "conditional" | "near-confirmed";
  milestoneNote: string;
  monthly: LiveMonitorMonthly[];
  diagnostics: LiveMonitorDiagnostic[];
  latestLiveDate: string | null;
  decisionCounts: LiveMonitorDecisionCount[];
  latestModelDecisionDate: string | null;
  latestAnyDecisionDate: string | null;
  latestOfficialProgramDate: string | null;
  latestOddsSnapshotDate: string | null;
  excludedOldModelCount: number;
  excludedSampleCount: number;
  sources: string[];
};

export async function fetchLiveB1Monitor(): Promise<LiveMonitorResponse> {
  const res = await fetch("/api/live/b1-monitor");
  if (!res.ok) throw new Error(`live b1 monitor api failed: ${res.status}`);
  return res.json();
}

export type { BacktestSummary, DecisionHistoryRow, ModelComparisonRow, MonthlySummary, SavingsSummary, VenueHeatmapSummary };
