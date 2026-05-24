import { Activity, Bell, CheckCircle2, Database, ExternalLink, HelpCircle, History, Settings, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  compareModelsApi,
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
  type DashboardResponse,
  type ModelComparisonRow,
  type OddsFetchResult,
  type WalkForwardResponse,
} from "./api";
import type { BudgetRule } from "./domain/types";
import { Tooltip } from "./components/Tooltip";
import "./styles.css";

type Screen = "dashboard" | "results" | "history" | "settings";

type CalendarDay = { date: string; buy: number; watch: number; skip: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(new Date()),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  const buyRows = data?.rows.filter((row) => row.decision.status === "BUY") ?? [];
  const watchRows = data?.rows.filter((row) => row.decision.status === "WATCH") ?? [];
  const skipRows = data?.rows.filter((row) => row.decision.status === "SKIP") ?? [];
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

            <section className="metrics" aria-label="today summary">
              <Metric icon={<Bell size={18} />} label="BUY候補" value={buyRows.length.toString()} />
              <Metric icon={<Activity size={18} />} label="WATCH" value={watchRows.length.toString()} />
              <Metric icon={<Database size={18} />} label="SKIP" value={skipRows.length.toString()} />
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
            {screen === "history" && <Backtest data={data} onSaved={refresh} />}
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
        <div className="candidateGrid">
          {data.rows.map(({ candidate, decision, officialUrl, explanation }) => (
            <article className={`card ${decision.status.toLowerCase()}`} key={candidate.raceId}>
              <div className="cardTop">
                <div>
                  <h4>{candidate.venue} {candidate.raceNo}R</h4>
                  <p>締切 {candidate.closeAt} / {candidate.betType}</p>
                </div>
                <span className={`status ${decision.status.toLowerCase()}`}>{decision.status}</span>
              </div>
              <div className="betLine">{candidate.selection.join("-")}</div>
              <div className="stats">
                <Stat tip="モデルが推定した的中確率です。高すぎる時ほど過学習に注意します。" label="推定的中率" value={`${(candidate.estimatedHitRate * 100).toFixed(1)}%`} />
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
                  公式で確認して購入 <ExternalLink size={15} />
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
        <p>実際に買ったかどうかだけ手動で残します。購入処理はしません。</p>
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
            {data.history.map((row) => (
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
  if (settings.oddsCalibrationFactors != null) {
    if (!Array.isArray(settings.oddsCalibrationFactors)) return "オッズ補正係数が不正です";
    for (const factor of settings.oddsCalibrationFactors) {
      if (!Number.isFinite(factor.maxRequiredOdds) || factor.maxRequiredOdds <= 0) return "補正の必要オッズ上限は0より大きい値にしてください";
      if (!Number.isFinite(factor.factor) || factor.factor <= 0) return "補正係数は0より大きい値にしてください";
    }
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
        <strong>{data.oddsSnapshots.length.toLocaleString()}件</strong>
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
