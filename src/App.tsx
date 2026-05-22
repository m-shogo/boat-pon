import { Activity, Bell, CheckCircle2, Database, ExternalLink, History, Settings, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchOdds,
  getDashboard,
  importOfficialRows,
  reparseKyotei24,
  sendBrowserNotification,
  updateManualOdds,
  updatePurchaseRecord,
  updateSettings,
  type DashboardResponse,
  type OddsFetchResult,
} from "./api";
import type { BudgetRule } from "./domain/types";
import "./styles.css";

type Screen = "dashboard" | "results" | "history" | "settings";

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(new Date()),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
            </section>

            {screen === "dashboard" && <MonthlyOverview data={data} />}
            {screen === "dashboard" && <Dashboard data={data} onNotify={refresh} onBrowserNotify={notifyUser} />}
            {screen === "dashboard" && <OfficialImport onImported={refresh} date={date} />}
            {screen === "results" && <Results data={data} />}
            {screen === "history" && <Backtest data={data} onSaved={refresh} />}
            {screen === "settings" && <SettingsScreen settings={data.settings} onSaved={refresh} />}
          </>
        )}
      </main>
    </div>
  );
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
          {data.rows.map(({ candidate, decision, officialUrl }) => (
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
                <Stat label="推定的中率" value={`${(candidate.estimatedHitRate * 100).toFixed(1)}%`} />
                <Stat label="必要オッズ" value={`${decision.requiredOdds.toFixed(1)}倍`} />
                <Stat label="現在オッズ" value={candidate.currentOdds ? `${candidate.currentOdds.toFixed(1)}倍` : "未取得"} />
                <Stat label="EV" value={decision.ev ? decision.ev.toFixed(2) : "-"} />
                <Stat label="サンプル数" value={candidate.sampleSize.toLocaleString()} />
                <Stat label="推奨金額" value={`${decision.recommendedAmount}円`} />
              </div>
              <div className="reasons">
                {decision.reasons.map((reason) => <span key={reason}>{reason}</span>)}
              </div>
              <ManualOddsInput
                raceId={candidate.raceId}
                defaultValue={candidate.currentOdds}
                onSaved={onNotify}
              />
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
        placeholder={"date,venue,raceNo,closeAt\\n" + date + ",蒲郡,8,18:42"}
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
  return (
    <section className="section">
      <div className="sectionHead">
        <div>
          <h3>バックテスト</h3>
          <p>判定履歴から的中率・回収率・BUY/WATCH/SKIPを検証。</p>
        </div>
      </div>
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
    </section>
  );
}

function validateSettings(settings: BudgetRule): string | null {
  const labels: Record<keyof BudgetRule, string> = {
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
    if (!Number.isFinite(value) || value <= 0) return `${label}は0より大きい値にしてください`;
  }
  if (settings.stakePerBetYen > settings.maxStakePerRaceYen) return "1点は1レース最大以下にしてください";
  if (settings.maxStakePerRaceYen > settings.dailyBudgetYen) return "1レース最大は1日予算以下にしてください";
  return null;
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
