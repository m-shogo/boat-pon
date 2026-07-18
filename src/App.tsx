import { Activity, Bell, CheckCircle2, Database, ExternalLink, HelpCircle, History, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compareModelsApi,
  fetchCandidateRowsApi,
  fetchCalibrationApi,
  fetchLiveB1Monitor,
  fetchHistoryApi,
  fetchOdds,
  fetchVapidPublicKey,
  getDashboard,
  importOfficialRows,
  reparseKyotei24,
  sendBrowserNotification,
  subscribePush,
  testPushBroadcast,
  runWalkForwardApi,
  updateManualOdds,
  updatePurchaseRecord,
  updateSettings,
  type CalibrationB1Rule,
  type CalibrationCompareResponse,
  type CalibrationReturnedStats,
  type CalibrationRow,
  type LiveMonitorDiagnostic,
  type LiveMonitorDecisionCount,
  type LiveMonitorResponse,
  type TodayDiagnosis,
  type DashboardResponse,
  type HistoryResponse,
  type ModelComparisonRow,
  type OddsFetchResult,
  type WalkForwardResponse,
} from "./api";
import { PAPER_LIVE_VALIDATION_RULE } from "./domain/decision";
import type { BudgetRule } from "./domain/types";
import { Tooltip } from "./components/Tooltip";
import { ResearchLab } from "./components/ResearchLab";
import "./styles.css";

type Screen = "dashboard" | "results" | "history" | "research" | "settings";

type CalendarDay = { date: string; buy: number; watch: number; skip: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(new Date()),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveMonitor, setLiveMonitor] = useState<LiveMonitorResponse | null>(null);
  const [liveMonitorError, setLiveMonitorError] = useState<string | null>(null);
  const [liveMonitorLoading, setLiveMonitorLoading] = useState(true);
  const [liveMonitorLastUpdated, setLiveMonitorLastUpdated] = useState<Date | null>(null);
  const [historyData, setHistoryData] = useState<HistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(() => localStorage.getItem("boatpon.guide.done") !== "1");

  async function notifyUser(title: string, body: string) {
    if (!("Notification" in window)) return;
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission === "granted") new Notification(title, { body });
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    setData(null);
    setHistoryData(null);
    setHistoryError(null);
    try {
      setData(await getDashboard(date));
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [date]);

  useEffect(() => {
    if (screen !== "history" || !data || historyData || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(null);
    fetchHistoryApi()
      .then(setHistoryData)
      .catch((err) => setHistoryError(err instanceof Error ? err.message : String(err)))
      .finally(() => setHistoryLoading(false));
  }, [screen, data, historyData, historyLoading]);

  const refreshLiveMonitor = useCallback(async () => {
    setLiveMonitorLoading(true);
    try {
      const report = await fetchLiveB1Monitor();
      setLiveMonitor(report);
      setLiveMonitorLastUpdated(new Date());
      setLiveMonitorError(null);
    } catch (err) {
      setLiveMonitorError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLiveMonitorLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLiveMonitor();
    const id = setInterval(() => void refreshLiveMonitor(), 60_000);
    return () => clearInterval(id);
  }, [refreshLiveMonitor]);

  const buyRows = data?.rows.filter((row) => row.decision.status === "BUY") ?? [];
  const watchRows = data?.decisionCounts?.watch ?? data?.rows.filter((row) => row.decision.status === "WATCH").length ?? 0;
  const skipRows = data?.decisionCounts?.skip ?? data?.rows.filter((row) => row.decision.status === "SKIP").length ?? 0;
  const totalPlanned = buyRows.reduce((sum, row) => sum + row.decision.recommendedAmount, 0);
  const noBetDays = data?.monthly.daysActive
    ? Math.round((data.monthly.noBuyDays / data.monthly.daysActive) * 100)
    : 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">BP</div>
          <div>
            <h1>Boat Pon</h1>
            <p>Boat EV Notifier</p>
          </div>
        </div>
        <nav className="nav" aria-label="main">
          <NavButton active={screen === "dashboard"} onClick={() => setScreen("dashboard")} icon={<Activity size={16} />} label="Dashboard" />
          <NavButton active={screen === "results"} onClick={() => setScreen("results")} icon={<Database size={16} />} label="Results" />
          <NavButton active={screen === "history"} onClick={() => setScreen("history")} icon={<History size={16} />} label="Backtest" />
          <NavButton active={screen === "research"} onClick={() => setScreen("research")} icon={<Activity size={16} />} label="Research" />
          <NavButton active={screen === "settings"} onClick={() => setScreen("settings")} icon={<Settings size={16} />} label="Settings" />
        </nav>
        <button className="helpButton" onClick={() => setGuideOpen(true)} aria-label="使い方を見る">
          <HelpCircle size={16} /> 使い方を見る
        </button>
        <div className="guardrail">
          <ShieldCheck size={18} />
          <p>自動購入・自動投票・ログイン保存・投票サイト操作は実装しません。</p>
        </div>
      </aside>

      <main className="main">
        {error && (
          <div className="errorBox">
            <span>APIエラー: {error}</span>
            <button onClick={() => void refresh()}>再試行</button>
          </div>
        )}
        {loading && <div className="loading">読み込み中...</div>}
        {!loading && data && (
          <>
            <div className="toolbar">
              <label>
                <span>対象日</span>
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <button onClick={async () => {
                await reparseKyotei24(date);
                await refresh();
              }}>
                保存済みrawを再取り込み
              </button>
            </div>

            <header className="hero">
              <div>
                <p className="eyebrow">LOCAL-FIRST / LOW-FREQUENCY FETCH / NO AUTO BETTING</p>
                <h2>{data.headline}</h2>
                <p>{data.headlineSub}</p>
              </div>
              <div className="systemBadge">
                <span>EV target</span>
                <strong>{data.settings.targetEv.toFixed(2)}</strong>
              </div>
            </header>

            {screen === "dashboard" && (
              <LiveMonitorSummaryPanel
                report={liveMonitor}
                error={liveMonitorError}
                loading={liveMonitorLoading}
                lastUpdated={liveMonitorLastUpdated}
                onRefresh={() => void refreshLiveMonitor()}
              />
            )}
            {screen === "dashboard" && <DataReadinessPanel data={data} />}

            <section className="metrics" aria-label="today summary">
              <Metric icon={<Bell size={18} />} label="BUY候補" value={buyRows.length.toString()} />
              <Metric icon={<Activity size={18} />} label="WATCH" value={watchRows.toString()} />
              <Metric icon={<Database size={18} />} label="SKIP" value={skipRows.toString()} />
              <Metric label="購入予定額" value={`${totalPlanned.toLocaleString()}円`} />
              <Metric label="本日の最大損失" value={`${data.settings.dailyBudgetYen.toLocaleString()}円`} />
              <Metric label="累計節約額" value={`${data.savings.savedLossYen.toLocaleString()}円`} />
              <Metric label="買わない連続日数" value={`${data.savings.consecutiveNoBuyDays}日`} />
              <Metric label="今月の見送り率" value={`${noBetDays}%`} />
            </section>

            {screen === "dashboard" && <SavingsPanel data={data} />}
            {screen === "dashboard" && <SafetyReview data={data} />}
            {screen === "dashboard" && <RoiBudgetPanel data={data} />}
            {screen === "dashboard" && <VenueHeatmap data={data} />}
            {screen === "dashboard" && <MonthlyOverview data={data} />}
            {screen === "dashboard" && <Dashboard data={data} onNotify={refresh} onBrowserNotify={notifyUser} />}
            {screen === "dashboard" && <SegmentStats data={data} />}
            {screen === "dashboard" && <SkipReasonPanel data={data} />}
            {screen === "dashboard" && <ModelHealthPanel data={data} />}
            {screen === "dashboard" && <ProgramStats data={data} />}
            {screen === "dashboard" && <OfficialImport onImported={refresh} date={date} />}
            {screen === "results" && <Results data={data} />}
            {screen === "history" && historyLoading && <div className="loading">バックテスト履歴を読み込み中...</div>}
            {screen === "research" && (
              <ResearchLab
                candidateRows={data.candidateRowCount ?? data.rows.length}
                racePrograms={data.beforeInfoCoverage?.totalRaces ?? 0}
              />
            )}
            {screen === "history" && historyError && <div className="formError">{historyError}</div>}
            {screen === "history" && historyData && <Backtest data={{ ...data, history: historyData.rows, backtest: historyData.backtest }} onSaved={refresh} />}
            {screen === "settings" && <SettingsScreen settings={data.settings} onSaved={refresh} />}
          </>
        )}
              {guideOpen && <GuideModal onClose={() => {
          localStorage.setItem("boatpon.guide.done", "1");
          setGuideOpen(false);
        }} />}
      </main>
    </div>
  );
}

function DataReadinessPanel({ data }: { data: DashboardResponse }) {
  const coverage = data.beforeInfoCoverage;
  if (!coverage) return null;
  const watchBuyLabel = coverage.watchBuyRaces === 0
    ? "WATCH/BUY対象なし"
    : `${coverage.watchBuyFullRaces}/${coverage.watchBuyRaces}件`;
  const fullLevel = readinessLevel(coverage.fullPct);
  const watchBuyLevel = coverage.watchBuyRaces === 0 ? "ok" : readinessLevel(coverage.watchBuyFullPct);
  return (
    <section className="section dataReadinessPanel">
      <div className="sectionHead">
        <div>
          <h3>データ準備状況</h3>
          <p>プロ視点では、BUY判断の前に今日の入力データが揃っているかを確認します。</p>
        </div>
      </div>
      <div className="readinessGrid">
        <ReadinessMetric label="直前情報フル取得" value={`${coverage.fullRaces}/${coverage.totalRaces}件`} pct={coverage.fullPct} level={fullLevel} />
        <ReadinessMetric label="展示" value={`${coverage.exhibitionRaces}件`} pct={coverage.exhibitionPct} level={readinessLevel(coverage.exhibitionPct)} />
        <ReadinessMetric label="天候/風/波" value={`${coverage.weatherRaces}件`} pct={coverage.weatherPct} level={readinessLevel(coverage.weatherPct)} />
        <ReadinessMetric label="チルト/部品" value={`${coverage.equipmentRaces}件`} pct={coverage.equipmentPct} level={readinessLevel(coverage.equipmentPct)} />
        <ReadinessMetric label="WATCH/BUY対象" value={watchBuyLabel} pct={coverage.watchBuyFullPct} level={watchBuyLevel} />
      </div>
      <div className="personaNotes">
        <span>勝負師: BUYを増やすより悪いBUYを消す</span>
        <span>データ担当: 取得率が低い日は判断保留</span>
        <span>資金管理: WATCHは購入導線にしない</span>
      </div>
    </section>
  );
}

function ReadinessMetric({
  label, value, pct, level,
}: {
  label: string;
  value: string;
  pct: number | null;
  level: "ok" | "warn" | "danger";
}) {
  return (
    <div className={`readinessMetric ${level}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{pct == null ? "n/a" : `${pct.toFixed(1)}%`}</em>
    </div>
  );
}

function readinessLevel(pct: number | null): "ok" | "warn" | "danger" {
  if (pct == null) return "ok";
  if (pct >= 80) return "ok";
  if (pct >= 30) return "warn";
  return "danger";
}

function LiveMonitorSummaryPanel({
  report, error, loading, lastUpdated, onRefresh,
}: {
  report: LiveMonitorResponse | null;
  error: string | null;
  loading: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  const summary = report?.summary;
  const pct = summary ? Math.min(100, Math.round((summary.n / 300) * 100)) : 0;
  const eta = report?.pace.eta;
  const watchBuy = report?.watchBuyQuality;
  const alert = report?.alerts[0] ?? null;

  return (
    <section className="liveMonitorPanel">
      <div className="liveMonitorHead">
        <div>
          <h3>Paper Live監視</h3>
          <p>実購入なし。n=300までは採用/撤退を確定しません。</p>
        </div>
        <div className="liveMonitorActions">
          {lastUpdated && (
            <span className="liveLastUpdated">
              {lastUpdated.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            className="liveRefreshButton"
            onClick={onRefresh}
            disabled={loading}
            aria-label="更新"
          >
            <RefreshCw size={12} className={loading ? "spinning" : ""} />
            {loading ? "更新中" : "更新"}
          </button>
          <span className={`liveAlertBadge ${alert?.level ?? "ok"}`}>
            {error ? "error" : alert?.code ?? "normal"}
          </span>
        </div>
      </div>
      {error && <div className="formError">{error}</div>}
      {!error && !report && loading && <div className="empty">live監視を読み込み中...</div>}
      {!error && !report && !loading && <div className="empty">データなし</div>}
      {report && (
        <>
          <div className="liveProgressRow">
            <div>
              <span>live BUY</span>
              <strong>{summary!.n}/300</strong>
            </div>
            <div className="progressTrack liveProgressTrack">
              <div className="progressFill ok" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="liveMonitorGrid">
            <Stat label="BUY=0連続" value={`${report.paperLive.consecutiveZeroBuyDays}日`} />
            <Stat label="WATCH+BUYオッズ" value={`${watchBuy!.oddsPresent}/${watchBuy!.n}`} />
            <Stat label="実測ETA" value={formatEta(eta!.liveDaysLeft)} />
            <Stat label="過去中央値ETA" value={formatEta(eta!.historicalMedianDaysLeft)} />
            <Stat label="保守ETA" value={formatEta(eta!.historicalMinDaysLeft)} />
            <Stat label="最新判定" value={report.latestModelDecisionDate ?? "-"} />
          </div>
          {report.alerts.length > 0 && (
            <div className="liveAlerts">
              {report.alerts.map((item) => (
                <div className={`liveAlert ${item.level}`} key={item.code}>
                  <strong>{item.code}</strong>
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          )}
          {report.todayDiagnosis && (
            <TodayDiagnosisBlock diag={report.todayDiagnosis} />
          )}
        </>
      )}
    </section>
  );
}

const CLOSE_STATUS_LABEL: Record<string, string> = {
  in_window: "受付中",
  too_early: "早すぎ",
  too_late: "遅すぎ",
  closed: "締切",
  no_close_at: "不明",
};

const DIAG_ACTION_LABEL: Record<string, string> = {
  "review paper BUY rows": "Paper BUY行を確認",
  "watch next odds refresh; open near-miss exists": "次のオッズ更新を確認（未締切の境界候補あり）",
  "review closed near-misses; no open near-miss within 1.0 odds": "締切済み境界候補を確認（未締切の境界候補なし）",
  "observe; WATCH exists but not near BUY boundary": "観察継続（WATCHはあるがBUY境界ではない）",
  "observe; no WATCH/BUY pressure yet": "観察継続（WATCH/BUY圧力なし）",
};

function TodayDiagnosisBlock({ diag }: { diag: TodayDiagnosis }) {
  return (
    <div className="diagnosisBlock">
      <div className="diagnosisBlockHead">
        <span>本日の診断</span>
        <span className="diagnosisBlockDate">{diag.date}</span>
      </div>
      <div className="diagnosisMiniStats">
        <div className="diagnosisMiniStat"><span>BUY</span>{diag.counts.BUY}</div>
        <div className="diagnosisMiniStat"><span>WATCH</span>{diag.counts.WATCH}</div>
        <div className="diagnosisMiniStat"><span>SKIP</span>{diag.counts.SKIP}</div>
        <div className="diagnosisMiniStat"><span>オッズ取得</span>{diag.oddsCoverage.present}/{diag.oddsCoverage.total}</div>
        <div className="diagnosisMiniStat"><span>境界内</span>{diag.nearMiss.within1_0}件</div>
        <div className="diagnosisMiniStat"><span>未締切</span>{diag.nearMiss.openWithin1_0}件</div>
        {diag.nearMiss.minGap != null && (
          <div className="diagnosisMiniStat"><span>最小ギャップ</span>{diag.nearMiss.minGap}</div>
        )}
        <div className="diagnosisMiniStat"><span>SKIP(必要以上)</span>{diag.skipAtOrAboveRequired}</div>
      </div>
      <div className="diagnosisAction">{DIAG_ACTION_LABEL[diag.action] ?? diag.action}</div>
      {diag.topNearMisses.length > 0 && (
        <div className="nearMissList">
          {diag.topNearMisses.map((nm) => (
            <div className="nearMissItem" key={nm.raceId}>
              <span className="nmVenue">{nm.venue} R{nm.raceNo}</span>
              <span className="nmOdds">{formatDiagNumber(nm.currentOdds)}/{formatDiagNumber(nm.requiredOdds)}</span>
              {nm.gap != null && <span className="nmGap">gap {formatDiagNumber(nm.gap)}</span>}
              <span className={`nmStatus ${nm.closeStatus}`}>
                {CLOSE_STATUS_LABEL[nm.closeStatus] ?? nm.closeStatus}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatEta(days: number | null) {
  return days == null ? "-" : `${days}日`;
}

function formatDiagNumber(value: number | null): string {
  if (value == null) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function SavingsPanel({ data }: { data: DashboardResponse }) {
  const s = data.savings;
  const message = s.savedLossYen > 0
    ? `BUYを全部買っていたら ${s.savedLossYen.toLocaleString()}円のマイナス想定。見送れて成功です。`
    : s.missedProfitYen > 0
      ? `今回は買っていれば +${s.missedProfitYen.toLocaleString()}円の想定。次の検証材料として記録します。`
      : "無理に買わず、資金を守っています。";
  return (
    <section className="section savingsHero">
      <div>
        <p className="eyebrow">NO-BET SUCCESS COUNTER</p>
        <h3>買わない判断の成果</h3>
        <p>{message}</p>
      </div>
      <div className="savingsStats">
        <Stat label="守った購入予定額" value={`${s.protectedStakeYen.toLocaleString()}円`} />
        <Stat label="未購入BUY候補" value={`${s.unboughtBuySignals}/${s.buySignals}件`} />
        <Stat label="実購入額" value={`${s.actualStakeYen.toLocaleString()}円`} />
      </div>
    </section>
  );
}

function SafetyReview({ data }: { data: DashboardResponse }) {
  const buyRows = data.rows.filter((row) => row.decision.status === "BUY");
  const riskyBuy = buyRows.filter((row) => row.candidate.hasRiskFlag || row.candidate.currentOdds == null);
  const planned = buyRows.reduce((sum, row) => sum + row.decision.recommendedAmount, 0);
  const checks = [
    { label: "自動購入なし", ok: true, value: "外部リンクのみ" },
    { label: "BUY候補の未確認リスク", ok: riskyBuy.length === 0, value: riskyBuy.length + "件" },
    { label: "本日の予定額", ok: planned <= data.settings.dailyBudgetYen, value: planned.toLocaleString() + "円" },
    { label: "BUY数上限", ok: buyRows.length <= data.settings.maxBuyCountPerDay, value: buyRows.length + " / " + data.settings.maxBuyCountPerDay },
  ];
  return (
    <section className="section safetyReview">
      <div className="sectionHead">
        <div>
          <h3>購入前セーフティチェック</h3>
          <p>BUYが出ても、公式確認と予算上限を通らない限り行動しません。</p>
        </div>
      </div>
      <div className="checkGrid">
        {checks.map((item) => (
          <div className={item.ok ? "checkItem ok" : "checkItem ng"} key={item.label}>
            <span>{item.ok ? "OK" : "確認"}</span>
            <strong>{item.label}</strong>
            <em>{item.value}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoiBudgetPanel({ data }: { data: DashboardResponse }) {
  const month = data.monthly;
  const spent = month.modelStakeYen;
  const budget = data.settings.dailyBudgetYen * Math.max(month.daysActive, 1);
  const progress = budget ? Math.min(1.2, spent / budget) : 0;
  const progressClass = progress >= 1 ? "danger" : progress >= 0.9 ? "warn" : "ok";
  return (
    <section className="section roiBudgetPanel">
      <div className="sectionHead">
        <div>
          <h3>累積ROIと月予算</h3>
          <p>検証上の購入予定額で月予算の消化を確認します。</p>
        </div>
      </div>
      <RoiLineChart rows={data.monthlyTrend} />
      <div className="budgetProgress">
        <div>
          <span>今月の検証投資</span>
          <strong>{spent.toLocaleString()}円 / {budget.toLocaleString()}円</strong>
        </div>
        <div className="progressTrack">
          <div className={`progressFill ${progressClass}`} style={{ width: `${Math.min(progress * 100, 100)}%` }} />
        </div>
      </div>
    </section>
  );
}

function RoiLineChart({ rows }: { rows: DashboardResponse["monthlyTrend"] }) {
  const points = rows.map((row, index) => {
    const cumulativeStake = rows.slice(0, index + 1).reduce((sum, r) => sum + r.modelStakeYen, 0);
    const cumulativePayout = rows.slice(0, index + 1).reduce((sum, r) => sum + r.modelPayoutYen, 0);
    return {
      label: row.ym,
      roi: cumulativeStake ? cumulativePayout / cumulativeStake : 0,
    };
  });
  if (points.length === 0) return <div className="empty">ROI推移はまだありません</div>;
  const width = 720;
  const height = 180;
  const min = Math.min(0, ...points.map((p) => p.roi));
  const max = Math.max(1, ...points.map((p) => p.roi));
  const spread = max - min || 1;
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - ((point.roi - min) / spread) * height;
    return { ...point, x, y };
  });
  const path = coords.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const baselineY = height - ((1 - min) / spread) * height;
  return (
    <div className="roiChartWrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="累積ROI推移">
        <line x1="0" x2={width} y1={baselineY} y2={baselineY} className="roiBaseline" />
        <path d={path} className="roiPath" />
        {coords.map((p) => (
          <g key={p.label}>
            <circle cx={p.x} cy={p.y} r="4" className="roiDot" />
            <text x={p.x} y={height - 4} textAnchor="middle">{p.label.slice(5)}</text>
          </g>
        ))}
      </svg>
      <div className="roiChartLegend">
        <span>累積ROI</span>
        <strong>{(points.at(-1)!.roi * 100).toFixed(1)}%</strong>
      </div>
    </div>
  );
}

function VenueHeatmap({ data }: { data: DashboardResponse }) {
  const heatmap = data.venueHeatmap;
  const cellMap = new Map<string, DashboardResponse["venueHeatmap"]["cells"][number]>(heatmap.cells.map((cell) => [`${cell.venue}|${cell.ym}`, cell]));
  return (
    <section className="section heatmapPanel">
      <div className="sectionHead">
        <div>
          <h3>会場別ROIヒートマップ</h3>
          <p>月ごとのBUY検証ROI。緑は好調、赤は苦手。</p>
        </div>
      </div>
      <div className="venueRankGrid">
        <RankList title="得意 Top3" rows={heatmap.best} />
        <RankList title="苦手 Top3" rows={heatmap.worst} />
      </div>
      <div className="heatmapScroll">
        <div className="heatmapGrid" style={{ gridTemplateColumns: `86px repeat(${Math.max(heatmap.months.length, 1)}, 62px)` }}>
          <div className="heatmapHead">会場</div>
          {heatmap.months.map((month) => <div className="heatmapHead" key={month}>{month.slice(5)}</div>)}
          {heatmap.venues.map((venue) => (
            <div className="heatmapRow" key={venue}>
              <div className="heatmapVenue">{venue}</div>
              {heatmap.months.map((month) => {
                const cell = cellMap.get(`${venue}|${month}`);
                return <div className={`heatCell ${roiClass(cell?.modelRoi ?? 0, cell?.buy ?? 0)}`} key={month} title={`${venue} ${month} ROI ${cell?.modelRoi ? (cell.modelRoi * 100).toFixed(1) : "-"}%`}>{cell?.buy ? (cell.modelRoi * 100).toFixed(0) : "-"}</div>;
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RankList({ title, rows }: { title: string; rows: DashboardResponse["venueHeatmap"]["best"] }) {
  return (
    <div className="rankList">
      <h4>{title}</h4>
      {rows.length === 0 && <p>まだデータなし</p>}
      {rows.map((row) => (
        <div key={row.venue}>
          <span>{row.venue}</span>
          <strong>{(row.modelRoi * 100).toFixed(1)}%</strong>
          <em>BUY {row.buy}</em>
        </div>
      ))}
    </div>
  );
}

function roiClass(roi: number, buy: number) {
  if (buy === 0) return "none";
  if (roi >= 1.5) return "good strong";
  if (roi >= 1) return "good";
  if (roi <= 0.5) return "bad strong";
  return "bad";
}

function MonthlyOverview({ data }: { data: DashboardResponse }) {
  const m = data.monthly;

  return (
    <section className="section">
      <div className="sectionHead">
        <div>
          <h3>今月の成績 ({m.ym})</h3>
          <p>有効サンプルのみ集計。買わない日も成功扱い。</p>
        </div>
      </div>
      <div className="monthlyPanel">
        <div className="metrics backtestMetrics">
          <Metric label="判定" value={m.decisions.toString()} />
          <Metric label="BUY" value={m.buy.toString()} />
          <Metric label="的中" value={m.hits.toString()} />
          <Metric label="的中率" value={m.buy ? `${(m.hitRate * 100).toFixed(1)}%` : "-"} />
          <Metric label="検証投資" value={`${m.modelStakeYen.toLocaleString()}円`} />
          <Metric label="検証回収率" value={m.modelStakeYen ? `${(m.modelRoi * 100).toFixed(1)}%` : "-"} />
          <Metric label="買わない日" value={`${m.noBuyDays}/${m.daysActive}日`} />
        </div>
        {data.monthlyTrend.length > 0 && (
          <div className="monthlyTrend">
            {data.monthlyTrend.slice(-6).map((row) => (
              <div className="monthlyTrendRow" key={row.ym}>
                <span>{row.ym}</span>
                <strong>{row.modelStakeYen ? `${(row.modelRoi * 100).toFixed(1)}%` : "-"}</strong>
                <em>BUY {row.buy} / 見送り日 {row.noBuyDays}</em>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Dashboard({
  data,
  onNotify,
  onBrowserNotify,
}: {
  data: DashboardResponse;
  onNotify: () => Promise<void>;
  onBrowserNotify: (title: string, body: string) => Promise<void>;
}) {
  const [oddsBusy, setOddsBusy] = useState(false);
  const [oddsLog, setOddsLog] = useState<OddsFetchResult[]>([]);
  const [autoFetch, setAutoFetch] = useState(false);
  const [detailRows, setDetailRows] = useState<DashboardResponse["rows"]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const candidateRows = detailRows.length > 0 ? detailRows : data.rows;
  const totalCandidateRows = data.candidateRowCount ?? data.rows.length;
  const hiddenCandidateCount = Math.max(0, totalCandidateRows - candidateRows.length);

  useEffect(() => {
    setDetailRows([]);
    setDetailError(null);
  }, [data.date]);

  async function runFetchOdds(raceIds?: string[]) {
    setOddsBusy(true);
    try {
      const { results } = await fetchOdds(raceIds);
      setOddsLog(results);
      await onNotify();
    } catch (err) {
      setOddsLog([{
        raceId: raceIds?.[0] ?? "all",
        odds: null,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }]);
    } finally {
      setOddsBusy(false);
    }
  }

  async function loadMoreCandidates() {
    setDetailBusy(true);
    setDetailError(null);
    try {
      const result = await fetchCandidateRowsApi({
        date: data.date ?? undefined,
        status: ["BUY", "WATCH", "SKIP"],
        limit: 100,
        offset: detailRows.length,
      });
      setDetailRows((current) => [...current, ...result.rows]);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailBusy(false);
    }
  }

  useEffect(() => {
    if (!autoFetch) return;
    const timer = setInterval(() => {
      if (!oddsBusy) void runFetchOdds();
    }, 60_000);
    return () => clearInterval(timer);
  }, [autoFetch, oddsBusy]);

  return (
    <>
      <section className="section">
        <div className="sectionHead">
          <div>
            <h3>候補レース</h3>
            <p>BUY条件を満たした時だけ通知対象。WATCH/SKIPは記録のみ。</p>
          </div>
          <div className="oddsControls">
            <label className="autoToggle">
              <input
                type="checkbox"
                checked={autoFetch}
                onChange={(event) => setAutoFetch(event.target.checked)}
              />
              <span>自動取得 (60秒)</span>
            </label>
            <button disabled={oddsBusy} onClick={() => runFetchOdds()}>
              {oddsBusy ? "取得中..." : "公式オッズ取得"}
            </button>
          </div>
        </div>
        {oddsLog.length > 0 && (
          <div className="oddsLog">
            {oddsLog.map((row) => (
              <span key={row.raceId} className={`oddsLogItem ${row.status}`}>
                {row.raceId}: {row.status}{row.odds != null ? ` ${row.odds.toFixed(1)}倍` : ""}
              </span>
            ))}
          </div>
        )}
        {hiddenCandidateCount > 0 && (
          <div className="candidateSummary">
            {hiddenCandidateCount.toLocaleString()}件は詳細カードを省略中。上部の件数、Paper Live監視、見送り理由ランキングで確認できます。
            <button className="inlineMiniButton" disabled={detailBusy} onClick={() => void loadMoreCandidates()}>
              {detailBusy ? "読み込み中..." : "候補詳細を100件追加"}
            </button>
          </div>
        )}
        {detailError && <div className="formError">{detailError}</div>}
        <div className="candidateGrid">
          {candidateRows.map(({ candidate, decision, officialUrl, explanation }, index) => (
            <article className={`card ${decision.status.toLowerCase()}`} key={`${candidate.raceId}/${candidate.selection.join("-")}/${index}`}>
              <div className="cardTop">
                <div>
                  <h4>{candidate.venue} {candidate.raceNo}R</h4>
                  <p>締切 {candidate.closeAt} / {candidate.betType}</p>
                </div>
                <span className={`status ${decision.status.toLowerCase()}`}>{decision.status}</span>
              </div>
              <div className="betLine">{candidate.selection.join("-")}</div>
              <div className="stats">
                <Stat tip={candidate.rawEstimatedHitRate != null ? "保守化前の推定から信頼下限に落とした、判定用の的中確率です。" : "モデルが推定した的中確率です。高すぎる時ほど過学習に注意します。"} label="判定的中率" value={`${(candidate.estimatedHitRate * 100).toFixed(1)}%`} />
                {candidate.rawEstimatedHitRate != null && (
                  <Stat tip="信頼下限で保守化する前のモデル推定です。判定には直接使いません。" label="保守化前" value={`${(candidate.rawEstimatedHitRate * 100).toFixed(1)}%`} />
                )}
                <Stat tip="目標EVを満たすために最低限必要なオッズです。" label="必要オッズ" value={`${decision.requiredOdds.toFixed(1)}倍`} />
                <Stat tip="公式取得 or 手動入力のオッズ。締切が近いほど信頼度が上がります。" label="現在オッズ" value={candidate.currentOdds ? `${candidate.currentOdds.toFixed(1)}倍` : "未取得"} />
                <Stat tip="期待値=推定的中率×現在オッズ。1.0で損益±0、1.25以上で割に合う水準です。" label="EV" value={decision.ev ? decision.ev.toFixed(2) : "-"} />
                <Stat tip="推定の根拠となる過去データの数。Settingsのminサンプル数を超えないとSKIP扱いになります。" label="サンプル数" value={candidate.sampleSize.toLocaleString()} />
                <Stat tip="BUY判定時に推奨する1点あたりの金額。Settingsで上限を変えられます。" label="推奨金額" value={`${decision.recommendedAmount}円`} />
              </div>
              <div className={`decisionExplain ${explanation.tone}`}>
                <strong>{explanation.headline}</strong>
                <p>{explanation.detail}</p>
                <div className="decisionChecklist">
                  {explanation.checklist.map((item) => (
                    <span className={item.ok ? "ok" : "ng"} key={item.label}>
                      {item.label}: {item.value}
                    </span>
                  ))}
                </div>
              </div>
              <div className="reasons">
                {decision.reasons.map((reason) => <span key={reason}>{reason}</span>)}
              </div>
              <ManualOddsInput
                raceId={candidate.raceId}
                defaultValue={candidate.currentOdds}
                onSaved={onNotify}
              />
              {decision.status === "BUY" && (
                <div className="finalChecklist">
                  <span>購入前: 公式オッズ確認</span>
                  <span>締切5分以上</span>
                  <span>欠場/返還なし</span>
                  <span>100円のみ</span>
                </div>
              )}
              <div className="cardActions">
                <button
                  className="miniButton"
                  disabled={oddsBusy}
                  onClick={() => runFetchOdds([candidate.raceId])}
                >
                  公式オッズ取得
                </button>
                <a className="officialLink" href={officialUrl} target="_blank" rel="noopener noreferrer">
                  {decision.status === "BUY" ? "公式で確認して購入" : "公式で確認"} <ExternalLink size={15} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="sectionHead">
          <div>
            <h3>通知センター</h3>
            <p>BUY候補のみ作成。送信済み重複はDBで防止。</p>
          </div>
        </div>
        <div className="notificationList">
          {data.notifications.length === 0 && <div className="empty">通知対象なし</div>}
          {data.notifications.map((notification) => (
            <div className="notification" key={notification.id}>
              <div>
                <strong>{notification.title}</strong>
                <pre>{notification.body}</pre>
              </div>
              <div className="notificationActions">
                <span className={`status ${notification.status === "SENT" ? "buy" : "watch"}`}>{notification.status}</span>
                <button
                  disabled={notification.status === "SENT"}
                  onClick={async () => {
                    await onBrowserNotify(notification.title, notification.body);
                    await sendBrowserNotification(notification.id);
                    await onNotify();
                  }}
                >
                  <CheckCircle2 size={15} /> 通知済みにする
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ManualOddsInput({
  raceId,
  defaultValue,
  onSaved,
}: {
  raceId: string;
  defaultValue: number | null;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(defaultValue?.toString() ?? "");
  const odds = Number(value);
  const canSave = Number.isFinite(odds) && odds > 0;
  useEffect(() => setValue(defaultValue?.toString() ?? ""), [defaultValue]);
  return (
    <div className="manualOdds">
      <label>
        <span>手動オッズ</span>
        <input
          inputMode="decimal"
          value={value}
          placeholder="例: 15.7"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button
        disabled={!canSave}
        onClick={async () => {
          await updateManualOdds(raceId, odds);
          await onSaved();
        }}
      >
        保存
      </button>
    </div>
  );
}

function OfficialImport({ date, onImported }: { date: string; onImported: () => Promise<void> }) {
  const [text, setText] = useState("");
  return (
    <section className="section">
      <div className="sectionHead">
        <div>
          <h3>公式DL ローカル取り込み</h3>
          <p>CSV/TSVを貼り付けて番組表を保存。列名は date, venue, raceNo, closeAt を推奨。</p>
        </div>
      </div>
      <textarea
        className="importBox"
        value={text}
        placeholder={"date,venue,raceNo,closeAt\
" + date + ",蒲郡,8,18:42"}
        onChange={(event) => setText(event.target.value)}
      />
      <button className="saveButton" onClick={async () => {
        const rows = parsePastedRows(text, date);
        await importOfficialRows(rows, "manual-paste");
        setText("");
        await onImported();
      }}>
        公式DLデータを取り込む
      </button>
    </section>
  );
}

function parsePastedRows(text: string, fallbackDate: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((value) => value.trim());
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return { date: row.date || fallbackDate, venue: row.venue, raceNo: row.raceNo, closeAt: row.closeAt || "12:00" };
  });
}

function Results({ data }: { data: DashboardResponse }) {
  return (
    <section className="section">
      <div className="sectionHead">
        <div>
          <h3>結果取り込み</h3>
          <p>kyotei24 raw HTML → normalized JSON → SQLite。</p>
        </div>
      </div>
      <ResultTable data={data} />
    </section>
  );
}

function Backtest({ data, onSaved }: { data: DashboardResponse; onSaved: () => Promise<void> }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedRows = selectedDate ? data.history.filter((row) => row.date === selectedDate) : [];
  const purchaseRows = data.history.slice(0, 100);
  const hiddenPurchaseRows = Math.max(0, data.history.length - purchaseRows.length);
  return (
    <section className="section">
      <div className="sectionHead">
        <div>
          <h3>バックテスト</h3>
          <p>判定履歴から的中率・回収率・BUY/WATCH/SKIPを検証。</p>
        </div>
      </div>
      <CalendarView data={data} selectedDate={selectedDate} onSelect={setSelectedDate} />
      {selectedDate && <DayDetail date={selectedDate} rows={selectedRows} />}
      <WalkForwardPanel date={data.date} />
      <ModelComparisonPanel date={data.date} />
      <CalibrationPanel date={data.date} />
      <LiveMonitorPanel />
      <ExportButtons />
      <div className="metrics backtestMetrics">
        <Metric label="判定数" value={data.backtest.decisions.toString()} />
        <Metric label="BUY" value={data.backtest.buy.toString()} />
        <Metric label="的中率" value={`${(data.backtest.hitRate * 100).toFixed(1)}%`} />
        <Metric label="検証投資" value={`${data.backtest.modelStakeYen.toLocaleString()}円`} />
        <Metric label="検証回収率" value={data.backtest.modelStakeYen ? `${(data.backtest.modelRoi * 100).toFixed(1)}%` : "-"} />
      </div>
      <div className="sectionSub">
        <h3>有効サンプルのみ</h3>
        <p>サンプル不足({data.backtest.excludedSampleShort}件)を除いた集計。minSampleSize={data.settings.minSampleSize}</p>
      </div>
      <div className="metrics backtestMetrics">
        <Metric label="有効判定数" value={data.backtest.validDecisions.toString()} />
        <Metric label="有効BUY" value={data.backtest.validBuy.toString()} />
        <Metric label="有効的中率" value={`${(data.backtest.validHitRate * 100).toFixed(1)}%`} />
        <Metric label="有効検証投資" value={`${data.backtest.validModelStakeYen.toLocaleString()}円`} />
        <Metric label="有効検証回収率" value={data.backtest.validModelStakeYen ? `${(data.backtest.validModelRoi * 100).toFixed(1)}%` : "-"} />
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>会場</th>
              <th>判定数</th>
              <th>BUY</th>
              <th>検証投資</th>
              <th>検証払戻</th>
              <th>検証回収率</th>
            </tr>
          </thead>
          <tbody>
            {data.backtest.byVenue.map((row) => (
              <tr key={row.venue}>
                <td>{row.venue}</td>
                <td>{row.count}</td>
                <td>{row.buy}</td>
                <td>{row.modelStakeYen.toLocaleString()}円</td>
                <td>{row.modelPayoutYen.toLocaleString()}円</td>
                <td>{row.modelStakeYen ? `${(row.modelRoi * 100).toFixed(1)}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sectionSub">
        <h3>過大評価分析</h3>
        <p>BUY判定なのに外れた条件を集計します。</p>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>会場</th>
              <th>買い目</th>
              <th>件数</th>
              <th>外れ</th>
              <th>平均EV</th>
              <th>メモ</th>
            </tr>
          </thead>
          <tbody>
            {data.backtest.overvaluation.map((row) => (
              <tr key={row.venue + row.selection}>
                <td>{row.venue}</td>
                <td>{row.selection}</td>
                <td>{row.count}</td>
                <td>{row.misses}</td>
                <td>{row.avgEv.toFixed(2)}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sectionSub">
        <h3>購入記録</h3>
        <p>
          実際に買ったかどうかだけ手動で残します。購入処理はしません。
          {hiddenPurchaseRows > 0 && ` 最新100件のみ表示中（残り${hiddenPurchaseRows.toLocaleString()}件はCSV exportで確認）。`}
        </p>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>会場</th>
              <th>R</th>
              <th>買い目</th>
              <th>判定</th>
              <th>記録</th>
            </tr>
          </thead>
          <tbody>
            {purchaseRows.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{row.venue}</td>
                <td>{row.raceNo}R</td>
                <td>{row.selection}</td>
                <td>{row.decision}</td>
                <td>
                  <button className="miniButton" onClick={async () => {
                    await updatePurchaseRecord(row.id, !row.actuallyBought, row.recommendedStakeYen || 100);
                    await onSaved();
                  }}>
                    {row.actuallyBought ? `購入済み ${row.stakeYen}円` : "未購入"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CalendarView({ data, selectedDate, onSelect }: { data: DashboardResponse; selectedDate: string | null; onSelect: (date: string) => void }) {
  const days = buildCalendarDays(data.history);
  return (
    <div className="calendarPanel">
      <div className="calendarGrid">
        {days.map((day) => (
          <button key={day.date} className={day.date === selectedDate ? "active" : ""} onClick={() => onSelect(day.date)}>
            <span>{day.date.slice(5)}</span>
            <div className="dots">
              {day.buy > 0 && <i className="buy" />}
              {day.watch > 0 && <i className="watch" />}
              {day.skip > 0 && <i className="skip" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DayDetail({ date, rows }: { date: string; rows: DashboardResponse["history"] }) {
  return (
    <div className="dayDetail">
      <h3>{date} の判定</h3>
      {rows.length === 0 && <p>この日の履歴はまだありません。</p>}
      {rows.slice(0, 12).map((row) => <span key={row.id}>{row.venue} {row.raceNo}R {row.decision} {row.selection}</span>)}
    </div>
  );
}

function WalkForwardPanel({ date }: { date: string | null }) {
  const [from, setFrom] = useState(date?.slice(0, 7) ? date.slice(0, 7) + "-01" : "");
  const [to, setTo] = useState(date ?? "");
  const [result, setResult] = useState<WalkForwardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await runWalkForwardApi({ from: from || undefined, to: to || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="walkForwardPanel">
      <div className="sectionHead">
        <div>
          <h3>時系列検証</h3>
          <p>対象日より前の結果だけでモデルを作り、未来データ混入を避けて検証します。</p>
        </div>
      </div>
      <div className="walkForwardControls">
        <label><span>開始</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>終了</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button disabled={busy} onClick={run}>{busy ? "検証中..." : "検証する"}</button>
      </div>
      {error && <div className="formError">{error}</div>}
      {result && (
        <>
          <div className="metrics backtestMetrics">
            <Metric label="対象R" value={result.summary.races.toString()} />
            <Metric label="モデル生成" value={result.summary.modeled.toString()} />
            <Metric label="BUY" value={result.summary.buy.toString()} />
            <Metric label="的中率" value={`${(result.summary.hitRate * 100).toFixed(1)}%`} />
            <Metric label="検証回収率" value={result.summary.modelStakeYen ? `${(result.summary.modelRoi * 100).toFixed(1)}%` : "-"} />
          </div>
          <div className="tableWrap walkForwardRows">
            <table>
              <thead><tr><th>日付</th><th>会場</th><th>R</th><th>判定</th><th>買い目</th><th>結果</th><th>学習数</th></tr></thead>
              <tbody>
                {result.rows.slice(0, 20).map((row) => (
                  <tr key={row.raceId}>
                    <td>{row.date}</td>
                    <td>{row.venue}</td>
                    <td>{row.raceNo}R</td>
                    <td>{row.decision}</td>
                    <td>{row.selection ?? "-"}</td>
                    <td>{row.result ?? "-"}</td>
                    <td>{row.trainResults}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ModelComparisonPanel({ date }: { date: string | null }) {
  const [from, setFrom] = useState(date?.slice(0, 7) ? date.slice(0, 7) + "-01" : "");
  const [to, setTo] = useState(date ?? "");
  const [rows, setRows] = useState<ModelComparisonRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await compareModelsApi({ from: from || undefined, to: to || undefined });
      setRows(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="walkForwardPanel">
      <div className="sectionHead">
        <div>
          <h3>モデル比較</h3>
          <p>現行・EV厳しめ・サンプル厚め・平滑化強めを同じ期間で比べます。</p>
        </div>
      </div>
      <div className="walkForwardControls">
        <label><span>開始</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>終了</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button disabled={busy} onClick={run}>{busy ? "比較中..." : "比較する"}</button>
      </div>
      {error && <div className="formError">{error}</div>}
      {rows.length > 0 && (
        <div className="tableWrap walkForwardRows">
          <table>
            <thead><tr><th>モデル</th><th>目標EV</th><th>最小サンプル</th><th>BUY</th><th>的中率</th><th>回収率</th><th>注意</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.variant.id}>
                  <td>{row.variant.label}</td>
                  <td>{row.variant.targetEv.toFixed(2)}</td>
                  <td>{row.variant.minSampleSize}</td>
                  <td>{row.summary.buy}</td>
                  <td>{row.summary.buy ? `${(row.summary.hitRate * 100).toFixed(1)}%` : "-"}</td>
                  <td>{row.summary.modelStakeYen ? `${(row.summary.modelRoi * 100).toFixed(1)}%` : "-"}</td>
                  <td>{row.caution ?? "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CalibrationTable({ rows }: { rows: CalibrationRow[] }) {
  const calibColor = (ratio: number) => {
    if (ratio === 0) return "#888";
    if (ratio >= 1.2) return "var(--green)";
    if (ratio >= 0.8) return "inherit";
    return "var(--red)";
  };

  if (rows.length === 0) return <p style={{ color: "#888", fontSize: "0.85em" }}>データなし</p>;

  return (
    <div className="tableWrap walkForwardRows">
      <table>
        <thead>
          <tr>
            <th>req帯</th><th>クラス</th><th>n</th><th>的中</th>
            <th>推定%</th><th>実測%</th><th>calib比</th><th>avg_odds</th><th>最大配当</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.req_band}-${row.cls}`}>
              <td>{row.req_band}</td>
              <td>{row.cls}</td>
              <td>{row.n}</td>
              <td>{row.hits}</td>
              <td>{row.avg_est_pct.toFixed(2)}%</td>
              <td>{row.actual_pct.toFixed(2)}%</td>
              <td style={{ color: calibColor(row.calib_ratio), fontWeight: "bold" }}>
                {row.calib_ratio.toFixed(3)}
              </td>
              <td>{row.avg_odds.toFixed(1)}</td>
              <td>{row.max_hit_odds > 0 ? `${row.max_hit_odds}x` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveMonitorPanel() {
  const [data, setData] = useState<LiveMonitorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await fetchLiveB1Monitor());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const milestoneColor: Record<LiveMonitorResponse["milestoneStatus"], string> = {
    insufficient: "#888",
    watch: "var(--yellow, #e6a817)",
    conditional: "var(--green)",
    "near-confirmed": "var(--green)",
  };

  // n < 300 時の ROI 解釈注記
  function roiCaution(n: number, roi: number | null): string | null {
    if (n >= 300) return null;
    if (roi === null) return null;
    if (roi >= 1.2) return "ROI高くても採用判断不可（n<300）。72〜100件では ROI 0〜2 の振れが通常範囲。";
    if (roi < 0.75) return "ROI低くても撤退確定ではない（n<300）。ゼロ的中確率は hit率1.5〜2%で n=100 時約13〜22%。";
    return "n<300のため参考値。ROIの振れ幅（標準誤差≈0.6〜0.7）より大きな変動は判断材料にならない。";
  }

  const s = data?.summary;
  const caution = s ? roiCaution(s.n, s.roi) : null;
  const totalModelDecisions = data?.decisionCounts.reduce((sum, row) => sum + row.n, 0) ?? 0;
  const buyCount = data?.decisionCounts.find((row) => row.decision === "BUY")?.n ?? 0;
  const zeroReason = data && s?.n === 0
    ? totalModelDecisions === 0
      ? `${data.period.modelVersion}の2026判定履歴がまだありません。ダッシュボード実運用記録が未発生です。`
      : buyCount === 0
        ? `${data.period.modelVersion}判定は記録されていますが、BUY条件を満たした候補はまだありません。`
        : null
    : null;

  return (
    <div className="walkForwardPanel">
      <div className="sectionHead">
        <div>
          <h3>2026 ライブ監視（現行ルール）</h3>
          <p>
            2026-01-01 以降の現行モデルBUY実績。外部検証とは完全分離した未使用データ。<br />
            app_settings は変更しない。条件変更・再チューニングはしない。
          </p>
        </div>
      </div>

      <div style={{ background: "rgba(100,100,255,0.08)", border: "1px solid rgba(100,100,255,0.3)", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: "0.83em", lineHeight: 1.7 }}>
        <strong>採用・撤退しきい値（固定・変更不可）:</strong><br />
        n&lt;300: <strong>データ不足・判断不可</strong>（ROI高くても採用不可、ROI低くても撤退確定ではない）<br />
        n=300〜600: 継続保留（ROI&lt;0.75 → 撤退候補）<br />
        n=600〜1000: ROI&gt;1.2 + 月別一発依存でない → 条件付き採用 / n=1000〜: 最大払戻除外ROI&gt;1.0 → 採用確定に近い<br />
        <span style={{ color: "#888" }}>外部検証(2020-2023) ROI≈0.74 — edge未確認状態でライブ蓄積中</span>
      </div>

      <div className="walkForwardControls">
        <button disabled={busy} onClick={load}>{busy ? "取得中..." : "集計する"}</button>
      </div>

      {error && <div className="formError">{error}</div>}

      {data && (
        <>
          {/* マイルストーン + ROI解釈注記 */}
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(0,0,0,0.15)", borderRadius: 6 }}>
            <div style={{ marginBottom: 6, color: milestoneColor[data.milestoneStatus], fontWeight: "bold", fontSize: "0.9em" }}>
              {data.milestoneNote}
            </div>
            {caution && (
              <div style={{ marginBottom: 6, color: "#e6a817", fontSize: "0.82em", lineHeight: 1.5 }}>
                ⚠ {caution}
              </div>
            )}
            {/* 主要指標 */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: "0.87em" }}>
              <span>n: <strong>{s!.n}</strong></span>
              <span>的中: <strong>{s!.hits}</strong></span>
              <span>推定的中: <strong>{s!.estimatedHits !== null ? s!.estimatedHits.toFixed(1) : "—"}</strong></span>
              <span>ROI: <strong>{s!.roi !== null ? s!.roi.toFixed(3) : "—"}</strong></span>
              <span>最大払戻除外ROI: <strong>{s!.roiExMax !== null ? s!.roiExMax.toFixed(3) : "—"}</strong></span>
              <span>最大払戻: <strong>{s!.maxHitOdds > 0 ? `${s!.maxHitOdds}x` : "—"}</strong></span>
              <span>返還: <strong>{s!.returnedN}</strong>件</span>
            </div>
            {/* オッズ指標 */}
            {s!.avgRequiredOdds !== null && (
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: "0.85em", marginTop: 6, color: "#aaa" }}>
                <span>avg_req: {s!.avgRequiredOdds.toFixed(1)}</span>
                <span>avg_cur: {s!.avgCurrentOdds !== null ? s!.avgCurrentOdds.toFixed(1) : "—"}</span>
                <span>avg_ratio: {s!.avgOddsRatio !== null ? s!.avgOddsRatio.toFixed(3) : "—"}</span>
              </div>
            )}
            {/* 最新記録日 + フィルター条件 */}
            <div style={{ fontSize: "0.78em", color: "#666", marginTop: 6 }}>
              最新記録日: {data.latestLiveDate ?? "なし"} ／ 対象: {data.period.filter}
            </div>
            <div style={{ fontSize: "0.78em", color: "#777", marginTop: 4, lineHeight: 1.5 }}>
              最新現行モデル判定: {data.latestModelDecisionDate ?? "なし"} ／ 最新全判定: {data.latestAnyDecisionDate ?? "なし"} ／
              最新番組表: {data.latestOfficialProgramDate ?? "なし"} ／ 最新オッズ: {data.latestOddsSnapshotDate ?? "なし"}
            </div>
            {zeroReason && (
              <div style={{ fontSize: "0.82em", color: "#aaa", marginTop: 6 }}>
                {zeroReason}
              </div>
            )}
          </div>

          {/* 月別テーブル */}
          {data.monthly.length > 0 ? (
            <div className="tableWrap walkForwardRows" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>月</th><th>n</th><th>的中</th><th>返還</th><th>ROI</th><th>avg_odds</th><th>avg_ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((row) => (
                    <tr key={row.ym}>
                      <td>{row.ym}</td>
                      <td>{row.n}</td>
                      <td>{row.hits}</td>
                      <td>{row.returned_n}</td>
                      <td style={{ color: row.roi !== null && row.roi >= 1.0 ? "var(--green)" : row.roi !== null ? "var(--red)" : "inherit" }}>
                        {row.roi !== null ? row.roi.toFixed(3) : "—"}
                      </td>
                      <td>{row.avg_odds.toFixed(1)}</td>
                      <td>{row.avg_ratio.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: "#888", fontSize: "0.85em", marginTop: 10 }}>
              {data.period.modelVersion} の2026 live BUYはまだ記録なし（n=0 は正常初期状態）。<br />
              ダッシュボードが実日付で起動すると自然に蓄積されます。
            </p>
          )}

          {/* 診断情報 */}
          <details style={{ marginTop: 12, fontSize: "0.8em", color: "#888" }}>
            <summary style={{ cursor: "pointer" }}>
              診断: 2026年BUY全件内訳（旧モデル除外 {data.excludedOldModelCount}件 / sample除外 {data.excludedSampleCount}件）
            </summary>
            <div style={{ marginTop: 6 }}>
              {data.decisionCounts.length > 0 && (
                <div className="tableWrap walkForwardRows" style={{ marginBottom: 8 }}>
                  <table>
                    <thead>
                      <tr><th>decision</th><th>n</th><th>最新日</th></tr>
                    </thead>
                    <tbody>
                      {data.decisionCounts.map((row: LiveMonitorDecisionCount) => (
                        <tr key={row.decision}>
                          <td>{row.decision}</td>
                          <td>{row.n}</td>
                          <td>{row.latest_date ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.diagnostics.length > 0 ? (
                <div className="tableWrap walkForwardRows">
                  <table>
                    <thead>
                      <tr><th>model_version</th><th>source</th><th>n</th><th>最新日</th><th>判定</th></tr>
                    </thead>
                    <tbody>
                      {data.diagnostics.map((row: LiveMonitorDiagnostic, i: number) => {
                        const isTarget = row.model_version === data.period.modelVersion;
                        return (
                          <tr key={i} style={{ opacity: isTarget ? 1 : 0.45 }}>
                            <td>{row.model_version}</td>
                            <td>{row.source}</td>
                            <td>{row.n}</td>
                            <td>{row.latest_date}</td>
                            <td style={{ color: isTarget ? "var(--green)" : "var(--red)" }}>
                              {isTarget ? "✓ 対象" : "✗ 除外"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>2026年のBUYレコードはまだありません。</p>
              )}
              <p style={{ marginTop: 4, lineHeight: 1.6 }}>
                source=sample は model_version=null のため自動除外。旧モデルも model_version で除外。<br />
                generate:history を2026年対象で実行すると現行モデルとして混入するため禁止。
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function CalibrationPanel({ date }: { date: string | null }) {
  const [b1filter, setB1filter] = useState(true);
  const [b1Rule, setB1Rule] = useState<CalibrationB1Rule["id"]>("current-live");
  const [compareResult, setCompareResult] = useState<CalibrationCompareResponse | null>(null);
  const [customFrom, setCustomFrom] = useState("2024-01-01");
  const [customTo, setCustomTo] = useState(date ?? "");
  const [customRows, setCustomRows] = useState<CalibrationRow[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runCompare() {
    setBusy(true);
    setError(null);
    try {
      const result = await fetchCalibrationApi({ mode: "compare", b1filter, b1Rule });
      setCompareResult(result as CalibrationCompareResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runCustom() {
    setBusy(true);
    setError(null);
    try {
      const result = await fetchCalibrationApi({ from: customFrom || undefined, to: customTo || undefined, b1filter, b1Rule });
      if ("rows" in result) setCustomRows(result.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const extSummary = compareResult?.external?.summary ?? null;
  const extFrom = compareResult?.external?.from ?? "2020-01-01";
  const extTo = compareResult?.external?.to ?? "2023-12-31";
  const returnedStats: CalibrationReturnedStats | null = compareResult?.insampleReturnedStats ?? null;
  const activeRule: CalibrationB1Rule = compareResult?.b1Rule ?? {
    id: b1Rule,
    label: b1Rule === "current-live" ? "現行live B1" : "旧検証 B1 + 2号艇≠B1",
    description: b1Rule === "current-live" ? "excludeSameClassSecondBoat=false" : "legacy-second-not-b1。boats[1].className != 'B1'",
    includesSecondBoatNotB1: b1Rule === "legacy-second-not-b1",
  };

  return (
    <div className="walkForwardPanel">
      <div className="sectionHead">
        <div>
          <h3>Calibration分析</h3>
          <p>required_odds帯×クラス別の実測/推定的中率比。1.0が理想、&lt;0.5は過大推定。</p>
        </div>
      </div>

      <div style={{ background: "rgba(255,180,0,0.12)", border: "1px solid rgba(255,180,0,0.5)", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: "0.85em", lineHeight: 1.6 }}>
        ⚠ <strong>採用判断ではなく校正確認用のパネルです。</strong> B1(ratio&lt;1.5) はedge未確認・ライブ蓄積継続中。<br />
        {extSummary ? (
          <>
            外部検証 ROI: <strong>{extSummary.roi.toFixed(3)}</strong>（{extFrom}〜{extTo} / n={extSummary.n}、{extSummary.hits}的中）—ランダムベット水準（≈0.75）。
          </>
        ) : (
          <>「外部/in-sample 比較」を実行すると外部ROIが表示されます。</>
        )}<br />
        calibration比が高くても外部ROIが改善しない限り採用根拠にはなりません。
      </div>

      <div className="walkForwardControls">
        <label>
          <input type="checkbox" checked={b1filter} onChange={(e) => setB1filter(e.target.checked)} />
          <span>B1プリセットを適用</span>
        </label>
        <label>
          <span>B1条件</span>
          <select value={b1Rule} onChange={(e) => setB1Rule(e.target.value as CalibrationB1Rule["id"])} disabled={!b1filter}>
            <option value="current-live">現行live: excludeSameClassSecondBoat=false</option>
            <option value="legacy-second-not-b1">旧検証: legacy-second-not-b1</option>
          </select>
        </label>
        <button disabled={busy} onClick={runCompare}>{busy ? "集計中..." : "外部/in-sample 比較"}</button>
        <button disabled={busy} onClick={() => setShowCustom(!showCustom)} style={{ marginLeft: 8 }}>
          {showCustom ? "カスタム非表示" : "カスタム期間"}
        </button>
      </div>

      {showCustom && (
        <div className="walkForwardControls" style={{ marginTop: 8 }}>
          <label><span>開始</span><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
          <label><span>終了</span><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          <button disabled={busy} onClick={runCustom}>{busy ? "集計中..." : "集計"}</button>
          {customRows.length > 0 && (
            <span style={{ fontSize: "0.8em", color: "#888", marginLeft: 8 }}>カスタム ({customRows.length}行)</span>
          )}
        </div>
      )}

      {error && <div className="formError">{error}</div>}

      {b1filter && (
        <div style={{ fontSize: "0.82em", color: "#888", marginBottom: 8 }}>
          B1条件: <strong>{activeRule.label}</strong> — {activeRule.description}
        </div>
      )}

      {showCustom && customRows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ fontSize: "0.9em", marginBottom: 4 }}>カスタム期間</h4>
          <CalibrationTable rows={customRows} />
        </div>
      )}

      {compareResult && (
        <>
          {returnedStats !== null && (
            <div style={{ fontSize: "0.82em", color: "#888", marginBottom: 8, padding: "4px 0" }}>
              In-sample BUY 返還: {returnedStats.returned ?? 0} / {returnedStats.total} 件
              （{returnedStats.pct != null ? returnedStats.pct.toFixed(2) : "0.00"}%）— 抑制ロジックなし・監視のみ
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 4 }}>
            <div>
              <h4 style={{ fontSize: "0.9em", marginBottom: 4 }}>
                外部検証: {compareResult.external.from} ～ {compareResult.external.to}
                {compareResult.external.summary && (
                  <span style={{ marginLeft: 8, color: compareResult.external.summary.roi >= 1.0 ? "var(--green)" : "var(--red)", fontWeight: "bold" }}>
                    ROI={compareResult.external.summary.roi.toFixed(3)} (n={compareResult.external.summary.n}, {compareResult.external.summary.hits}的中)
                  </span>
                )}
              </h4>
              <CalibrationTable rows={compareResult.external.rows} />
            </div>
            <div>
              <h4 style={{ fontSize: "0.9em", marginBottom: 4 }}>
                In-sample: {compareResult.insample.from} ～ 現在
                <span style={{ marginLeft: 8, fontSize: "0.8em", color: "#888" }}>（学習期間内・過学習注意）</span>
              </h4>
              <CalibrationTable rows={compareResult.insample.rows} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ExportButtons() {
  return (
    <div className="exportButtons">
      <a href="/api/export/results.csv">結果CSV</a>
      <a href="/api/export/history.csv">履歴CSV</a>
      <a href="/api/export/monthly.csv">月次CSV</a>
      <a href="/api/export/odds.csv">オッズCSV</a>
    </div>
  );
}

function buildCalendarDays(rows: DashboardResponse["history"]): CalendarDay[] {
  const map = new Map<string, CalendarDay>();
  for (const row of rows) {
    const day = map.get(row.date) ?? { date: row.date, buy: 0, watch: 0, skip: 0 };
    if (row.decision === "BUY") day.buy += 1;
    if (row.decision === "WATCH") day.watch += 1;
    if (row.decision === "SKIP") day.skip += 1;
    map.set(row.date, day);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 42);
}

function SettingsScreen({ settings, onSaved }: { settings: BudgetRule; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(settings);
    setSaveError(null);
  }, [settings]);

  const validationPreset = useMemo(() => ({
    ...PAPER_LIVE_VALIDATION_RULE,
    programFilter: PAPER_LIVE_VALIDATION_RULE.programFilter
      ? { ...PAPER_LIVE_VALIDATION_RULE.programFilter }
      : undefined,
    classOddsRatioRules: PAPER_LIVE_VALIDATION_RULE.classOddsRatioRules?.map((rule) => ({
      ...rule,
      classNames: [...rule.classNames],
    })),
    venueSignalBandRules: PAPER_LIVE_VALIDATION_RULE.venueSignalBandRules?.map((rule) => ({
      ...rule,
      venues: [...rule.venues],
    })),
    excludedVenues: PAPER_LIVE_VALIDATION_RULE.excludedVenues
      ? [...PAPER_LIVE_VALIDATION_RULE.excludedVenues]
      : undefined,
    excludedRaceNos: PAPER_LIVE_VALIDATION_RULE.excludedRaceNos
      ? [...PAPER_LIVE_VALIDATION_RULE.excludedRaceNos]
      : undefined,
  }), []);

  const fields = useMemo(() => [
    ["targetEv", "目標EV", 0.05],
    ["dailyBudgetYen", "1日予算", 100],
    ["stakePerBetYen", "1点", 100],
    ["maxStakePerRaceYen", "1レース最大", 100],
    ["maxBuyCountPerDay", "1日最大BUY数", 1],
    ["minSampleSize", "最小サンプル数", 50],
    ["minMinutesBeforeClose", "締切前分数", 1],
  ] as const, []);

  const validationError = validateSettings(draft);

  return (
    <section className="section">
      <div className="sectionHead">
        <div>
          <h3>設定 / 安全装置</h3>
          <p>厳しめの予算ルールを維持。変更はローカルSQLiteに保存。</p>
        </div>
      </div>
      <div className="settingsGrid">
        {fields.map(([key, label, step]) => (
          <label className="settingField" key={key}>
            <span>{label}</span>
            <input
              type="number"
              step={step}
              value={draft[key]}
              min={step}
              aria-invalid={draft[key] <= 0}
              onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
            />
          </label>
        ))}
        <label className="settingField">
          <span>補正モード</span>
          <select
            value={draft.calibrationMode ?? "none"}
            onChange={(event) => setDraft({ ...draft, calibrationMode: event.target.value as BudgetRule["calibrationMode"] })}
          >
            <option value="none">なし</option>
            <option value="v3-empirical">v3実測補正</option>
          </select>
        </label>
        <label className="settingField">
          <span>補正基準</span>
          <select
            value={draft.calibrationBasis ?? "requiredOdds"}
            onChange={(event) => setDraft({ ...draft, calibrationBasis: event.target.value as BudgetRule["calibrationBasis"] })}
          >
            <option value="requiredOdds">必要オッズ</option>
            <option value="currentOdds">取得オッズ</option>
          </select>
        </label>
        <label className="settingField">
          <span>オッズ上限</span>
          <input
            type="number"
            step={1}
            value={draft.maxOdds ?? ""}
            placeholder="例: 50"
            onChange={(event) => setDraft({
              ...draft,
              maxOdds: event.target.value === "" ? undefined : Number(event.target.value),
            })}
          />
        </label>
        <div className="settingField">
          <span>1着候補級別</span>
          <div className="classChecks">
            {["A1", "A2", "B1", "B2"].map((className) => {
              const checked = draft.programFilter?.allowedClassNames?.includes(className) ?? false;
              return (
                <label key={className}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const current = draft.programFilter?.allowedClassNames ?? [];
                      const allowedClassNames = event.target.checked
                        ? [...new Set([...current, className])]
                        : current.filter((value) => value !== className);
                      setDraft({ ...draft, programFilter: { ...draft.programFilter, allowedClassNames: allowedClassNames.length ? allowedClassNames : undefined } });
                    }}
                  />
                  {className}
                </label>
              );
            })}
          </div>
        </div>
        <label className="settingField">
          <span>モーター2連率上限</span>
          <input
            type="number"
            step={1}
            value={draft.programFilter?.maxMotorTop2Rate ?? ""}
            placeholder="40"
            onChange={(event) => setDraft({
              ...draft,
              programFilter: {
                ...draft.programFilter,
                maxMotorTop2Rate: event.target.value === "" ? undefined : Number(event.target.value),
              },
            })}
          />
        </label>
        <label className="settingField">
          <span>ボート2連率上限</span>
          <input
            type="number"
            step={1}
            value={draft.programFilter?.maxBoatTop2Rate ?? ""}
            placeholder="将来用"
            onChange={(event) => setDraft({
              ...draft,
              programFilter: {
                ...draft.programFilter,
                maxBoatTop2Rate: event.target.value === "" ? undefined : Number(event.target.value),
              },
            })}
          />
        </label>
        <label className="settingField">
          <span>2着候補同クラス除外</span>
          <input
            type="checkbox"
            checked={draft.programFilter?.excludeSameClassSecondBoat ?? false}
            onChange={(event) => setDraft({
              ...draft,
              programFilter: {
                ...draft.programFilter,
                excludeSameClassSecondBoat: event.target.checked || undefined,
              },
            })}
          />
          <span style={{ fontSize: "0.85em", color: "#666" }}>1着=2着が同クラスを除外</span>
        </label>
        <label className="settingField">
          <span>必要オッズ下限</span>
          <input
            type="number"
            step={1}
            value={draft.minRequiredOdds ?? ""}
            placeholder="例: 25"
            onChange={(event) => setDraft({
              ...draft,
              minRequiredOdds: event.target.value === "" ? undefined : Number(event.target.value),
            })}
          />
        </label>
        <label className="settingField">
          <span>必要オッズ上限</span>
          <input
            type="number"
            step={1}
            value={draft.maxRequiredOdds ?? ""}
            placeholder="例: 30"
            onChange={(event) => setDraft({
              ...draft,
              maxRequiredOdds: event.target.value === "" ? undefined : Number(event.target.value),
            })}
          />
        </label>
        <label className="settingField">
          <span>直前情報なしBUY抑制</span>
          <input
            type="checkbox"
            checked={draft.requireBeforeInfoForBuy ?? false}
            onChange={(event) => setDraft({
              ...draft,
              requireBeforeInfoForBuy: event.target.checked || undefined,
            })}
          />
          <span style={{ fontSize: "0.85em", color: "#86a69c" }}>展示・天候・チルト/部品が揃うまでWATCH保留</span>
        </label>
      </div>
      <div className="presetActions">
        <button type="button" onClick={() => setDraft(validationPreset)}>
          検証プリセットを下書きへ適用
        </button>
        <span>minSampleSize=1200 / maxOdds=50 / maxRequiredOdds=50</span>
      </div>
      <div className="formRow">
        <label>
          除外レース番号（カンマ区切り、例: 2,8）
          <input
            type="text"
            value={draft.excludedRaceNos?.join(",") ?? ""}
            placeholder="例: 2,8（空欄=全レース対象）"
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (raw === "") {
                setDraft({ ...draft, excludedRaceNos: undefined });
              } else {
                const nums = raw.split(",").map((s) => Number(s.trim())).filter(Number.isInteger);
                setDraft({ ...draft, excludedRaceNos: nums.length ? nums : undefined });
              }
            }}
          />
        </label>
      </div>
      {(validationError || saveError) && <div className="formError">{validationError ?? saveError}</div>}
      <button className="saveButton" disabled={Boolean(validationError)} onClick={async () => {
        setSaveError(null);
        try {
          await updateSettings(draft);
          await onSaved();
        } catch (err) {
          setSaveError(err instanceof Error ? err.message : String(err));
        }
      }}>
        設定を保存
      </button>
      <PushSubscribePanel />
    </section>
  );
}

function validateSettings(settings: BudgetRule): string | null {
  const labels: Partial<Record<keyof BudgetRule, string>> = {
    dailyBudgetYen: "1日予算",
    stakePerBetYen: "1点",
    maxStakePerRaceYen: "1レース最大",
    maxBuyCountPerDay: "1日最大BUY数",
    minSampleSize: "最小サンプル数",
    minMinutesBeforeClose: "締切前分数",
    targetEv: "目標EV",
  };
  for (const [key, label] of Object.entries(labels) as Array<[keyof BudgetRule, string]>) {
    const value = settings[key];
    if (!Number.isFinite(value) || (value as number) <= 0) return `${label}は0より大きい値にしてください`;
  }
  if (settings.stakePerBetYen > settings.maxStakePerRaceYen) return "1点は1レース最大以下にしてください";
  if (settings.maxStakePerRaceYen > settings.dailyBudgetYen) return "1レース最大は1日予算以下にしてください";
  if (settings.calibrationMode != null && !["none", "v3-empirical"].includes(settings.calibrationMode)) return "補正モードが不正です";
  if (settings.calibrationBasis != null && !["requiredOdds", "currentOdds"].includes(settings.calibrationBasis)) return "補正基準が不正です";
  if (settings.maxOdds != null && (!Number.isFinite(settings.maxOdds) || settings.maxOdds <= 0)) return "オッズ上限は0より大きい値にしてください";
  if (settings.oddsCalibrationFactors != null) {
    if (!Array.isArray(settings.oddsCalibrationFactors)) return "オッズ補正係数が不正です";
    for (const factor of settings.oddsCalibrationFactors) {
      if (!Number.isFinite(factor.maxRequiredOdds) || factor.maxRequiredOdds <= 0) return "補正の必要オッズ上限は0より大きい値にしてください";
      if (!Number.isFinite(factor.factor) || factor.factor <= 0) return "補正係数は0より大きい値にしてください";
    }
  }
  if (settings.programFilter != null) {
    if (settings.programFilter.allowedClassNames != null && settings.programFilter.allowedClassNames.some((name) => !["A1", "A2", "B1", "B2"].includes(name))) return "1着候補級別が不正です";
    if (settings.programFilter.maxMotorTop2Rate != null && (!Number.isFinite(settings.programFilter.maxMotorTop2Rate) || settings.programFilter.maxMotorTop2Rate < 0 || settings.programFilter.maxMotorTop2Rate > 100)) return "モーター2連率上限は0〜100で入力してください";
    if (settings.programFilter.maxBoatTop2Rate != null && (!Number.isFinite(settings.programFilter.maxBoatTop2Rate) || settings.programFilter.maxBoatTop2Rate < 0 || settings.programFilter.maxBoatTop2Rate > 100)) return "ボート2連率上限は0〜100で入力してください";
    if (settings.programFilter.excludeSameClassSecondBoat != null && typeof settings.programFilter.excludeSameClassSecondBoat !== "boolean") return "2着候補同クラス除外の設定が不正です";
  }
  if (settings.minRequiredOdds != null && (!Number.isFinite(settings.minRequiredOdds) || settings.minRequiredOdds <= 0)) return "必要オッズ下限は0より大きい値にしてください";
  if (settings.maxRequiredOdds != null && (!Number.isFinite(settings.maxRequiredOdds) || settings.maxRequiredOdds <= 0)) return "必要オッズ上限は0より大きい値にしてください";
  if (settings.minRequiredOdds != null && settings.maxRequiredOdds != null && settings.minRequiredOdds >= settings.maxRequiredOdds) return "必要オッズ下限は上限より小さい値にしてください";
  if (settings.excludedVenues != null && !Array.isArray(settings.excludedVenues)) return "除外会場の設定が不正です";
  if (settings.excludedRaceNos != null && (!Array.isArray(settings.excludedRaceNos) || settings.excludedRaceNos.some((v) => !Number.isInteger(v) || v < 1 || v > 12))) return "除外レース番号は1〜12の整数配列にしてください";
  if (settings.requireBeforeInfoForBuy != null && typeof settings.requireBeforeInfoForBuy !== "boolean") return "直前情報なしBUY抑制の設定が不正です";
  if (settings.venueSignalBandRules != null) {
    if (!Array.isArray(settings.venueSignalBandRules)) return "会場別シグナル帯ルールの設定が不正です";
    if (settings.venueSignalBandRules.some((rule) => !Array.isArray(rule.venues) || !["S", "A", "B"].includes(rule.minBand))) return "会場別シグナル帯ルールはS/A/Bで指定してください";
  }
  return null;
}

function PushSubscribePanel() {
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function subscribe() {
    setBusy(true);
    setStatus("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("このブラウザはWeb Push非対応です。iOS Safariは16.4以降+ホーム画面追加が必要です。");
        return;
      }
      const { publicKey, enabled } = await fetchVapidPublicKey();
      if (!enabled || !publicKey) {
        setStatus("サーバーにVAPIDキーが設定されていません。`npm run generate:vapid` で生成してください。");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("通知の許可が必要です。ブラウザ設定で「許可」にしてください。");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
      const result = await subscribePush(sub.toJSON() as PushSubscriptionJSON);
      setStatus(result.ok ? "✓ Push購読しました。BUY候補発生時に通知されます。" : "購読に失敗しました。");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function testPush() {
    setBusy(true);
    setStatus("");
    try {
      const result = await testPushBroadcast();
      setStatus(result.ok ? `テスト送信: 成功${result.sent}件 / 失敗${result.failed}件` : `エラー: ${result.error}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pushPanel">
      <h4>Web Push通知 (PWA)</h4>
      <p>ブラウザを閉じていてもBUY候補発生時に通知が届きます。事前にVAPIDキー設定が必要です。</p>
      <div className="pushActions">
        <button disabled={busy} onClick={subscribe}>通知を購読する</button>
        <button disabled={busy} onClick={testPush}>テスト送信</button>
      </div>
      {status && <p className="pushStatus">{status}</p>}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function ResultTable({ data }: { data: DashboardResponse }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>日付</th>
            <th>会場</th>
            <th>R</th>
            <th>3連単</th>
            <th>払戻</th>
            <th>人気</th>
            <th>返還</th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((result) => (
            <tr key={result.raceId}>
              <td>{result.date}</td>
              <td>{result.venue}</td>
              <td>{result.raceNo}R</td>
              <td>{result.trifecta ?? "-"}</td>
              <td>{result.payoutYen ? `${result.payoutYen.toLocaleString()}円` : "-"}</td>
              <td>{result.popularity ?? "-"}</td>
              <td>{result.returned ? "あり" : "なし"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon} {label}
    </button>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function SegmentStats({ data }: { data: DashboardResponse }) {
  return (
    <section className="section compactStats">
      <div className="sectionHead"><div><h3>時間帯・R別ROI</h3><p>買う時間帯とレース番号の偏りを見ます。</p></div></div>
      <MiniRoiTable title="時間帯" rows={data.segmentStats.byTimeBand} />
      <MiniRoiTable title="レース番号" rows={data.segmentStats.byRaceNo} />
    </section>
  );
}

function SkipReasonPanel({ data }: { data: DashboardResponse }) {
  return (
    <section className="section compactStats">
      <div className="sectionHead">
        <div>
          <h3>見送り理由ランキング</h3>
          <p>SKIPが多い理由を分解し、改善すべき入力データを見つけます。</p>
        </div>
      </div>
      <div className="miniRoiTable fullSpan">
        <h4>SKIP理由</h4>
        {data.skipReasons.length === 0 && <p className="miniEmpty">まだSKIP履歴がありません。</p>}
        {data.skipReasons.slice(0, 8).map((row) => (
          <div key={row.reason}>
            <span>{row.reason}</span>
            <strong>{row.count}件</strong>
            <em>{(row.share * 100).toFixed(0)}%</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModelHealthPanel({ data }: { data: DashboardResponse }) {
  const drift = data.rollingDrift.latest;
  return (
    <section className="section compactStats">
      <div className="sectionHead">
        <div>
          <h3>モデル監視</h3>
          <p>競技環境・番組カテゴリ・月次ドリフトを分けて、期待値の崩れを早めに見つけます。</p>
        </div>
      </div>
      <div className="modelInfoCard">
        <span>現行モデル</span>
        <strong>{data.modelVersion.version}</strong>
        <p>{data.modelVersion.description} / {data.modelVersion.features.slice(0, 2).join(" / ")}</p>
      </div>
      <div className={`modelInfoCard ${drift?.alert ?? "watch"}`}>
        <span>直近月キャリブレーション</span>
        <strong>{drift ? `${drift.ym} ${(drift.calibration * 100).toFixed(1)}%` : "データ待ち"}</strong>
        <p>{drift ? `BUY ${drift.buy}件 / 推定 ${(drift.avgEstimatedHitRate * 100).toFixed(1)}% / 実績 ${(drift.hitRate * 100).toFixed(1)}%` : "BUY履歴が貯まると表示します。"}</p>
      </div>
      <MiniRoiTable title="番組カテゴリ別ROI" rows={data.categoryStats.rows} />
      <div className="modelInfoCard">
        <span>オッズ履歴</span>
        <strong>{(data.oddsSnapshotCount ?? data.oddsSnapshots.length).toLocaleString()}件</strong>
        <p>手動・公式取得のオッズを履歴化。今後の過去オッズ補完も同じ器に入れます。</p>
      </div>
    </section>
  );
}

function ProgramStats({ data }: { data: DashboardResponse }) {
  const hasData =
    data.programStats.racersBest.length > 0 ||
    data.programStats.motorsBest.length > 0 ||
    data.programStats.classes.length > 0;

  return (
    <section className="section compactStats">
      <div className="sectionHead">
        <div>
          <h3>選手・モーター統計</h3>
          <p>BUY判定の1着艇に対する選手・モーター・級別の成績。番組表raw_jsonの艇情報が必要です。</p>
        </div>
      </div>
      {hasData ? (
        <>
          <MiniRoiTable title="選手Top10" rows={data.programStats.racersBest} />
          <MiniRoiTable title="選手Worst10" rows={data.programStats.racersWorst} />
          <MiniRoiTable title="モーターTop10" rows={data.programStats.motorsBest} />
          <MiniRoiTable title="モーターWorst10" rows={data.programStats.motorsWorst} />
          <MiniRoiTable title="級別" rows={data.programStats.classes} />
        </>
      ) : (
        <div className="empty">
          番組表データ準備中。公式番組表(B)の整形フェーズが完了すると艇情報が利用可能になり、ここに選手・モーター・級別の集計が表示されます。
        </div>
      )}
    </section>
  );
}

function MiniRoiTable({ title, rows }: { title: string; rows: Array<{ key: string; label: string; buy: number; modelRoi: number }> }) {
  return (
    <div className="miniRoiTable">
      <h4>{title}</h4>
      {rows.slice(0, 12).map((row) => (
        <div key={row.key}><span>{row.label}</span><strong>{row.buy ? (row.modelRoi * 100).toFixed(1) + "%" : "-"}</strong><em>BUY {row.buy}</em></div>
      ))}
    </div>
  );
}

function GuideModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: "Boat Ponは「割に合う時だけ」教えます",
      body: "EV(期待値)が1.25以上のときだけBUY候補として通知します。ほとんどの日はBUY候補が出ません。それが正常です。",
    },
    {
      title: "BUY / WATCH / SKIP の意味",
      body: "BUYは買って良い水準。WATCHは惜しい（EV1.05〜目標未満）。SKIPは見送り。WATCH/SKIPはあくまで記録で、購入を促しません。",
    },
    {
      title: "「買わない日」も成功",
      body: "Boat Ponの最終ゴールは『数字的に割に合う時だけ買う、ほとんどの日は買わない』。買わなかった日も累計節約額として可視化します。",
    },
    {
      title: "最終確認は必ず公式で",
      body: "オッズは締切直前で変動します。アプリ内で購入はしません。公式リンクで最終確認 → 1点100円までの少額のみ。",
    },
  ];
  const isLast = step === steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !isLast) setStep((s) => s + 1);
      if (e.key === "ArrowLeft" && step > 0) setStep((s) => s - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLast, step, onClose]);

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="guideModal" onClick={(e) => e.stopPropagation()}>
        <p className="guideStep">STEP {step + 1} / {steps.length}</p>
        <h2>{steps[step].title}</h2>
        <p className="guideBody">{steps[step].body}</p>
        <div className="guideActions">
          <button onClick={onClose} className="guideSkip">あとで</button>
          {step > 0 && <button onClick={() => setStep((s) => s - 1)} className="guideBack">戻る</button>}
          {!isLast && <button onClick={() => setStep((s) => s + 1)} className="guideNext">次へ</button>}
          {isLast && <button onClick={onClose} className="guideNext">始める</button>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="stat">
      <span>{tip ? <Tooltip label={label} hint={tip} /> : label}</span>
      <strong>{value}</strong>
    </div>
  );
}
