import { Activity, Bell, Database, ExternalLink, ShieldCheck } from "lucide-react";
import { DEFAULT_RULE, judgeCandidate } from "./domain/decision";
import { sampleCandidates, sampleResults } from "./sampleData";
import "./styles.css";

const officialOddsUrl = "https://www.boatrace.jp/owpc/pc/race/odds3t";

export default function App() {
  const now = new Date("2026-05-21T15:00:00+09:00");
  let reservedBudgetYen = 0;
  let buyCountToday = 0;

  const rows = sampleCandidates.map((candidate) => {
    const decision = judgeCandidate(candidate, DEFAULT_RULE, {
      now,
      buyCountToday,
      reservedBudgetYen,
    });
    if (decision.status === "BUY") {
      buyCountToday += 1;
      reservedBudgetYen += decision.recommendedAmount;
    }
    return { candidate, decision };
  });

  const buyRows = rows.filter((row) => row.decision.status === "BUY");
  const watchRows = rows.filter((row) => row.decision.status === "WATCH");
  const skipRows = rows.filter((row) => row.decision.status === "SKIP");
  const totalPlanned = buyRows.reduce((sum, row) => sum + row.decision.recommendedAmount, 0);
  const headline = buyRows.length > 0 ? "BUY候補あり" : "全レース見送り";
  const headlineSub = buyRows.length > 0
    ? "購入前に公式オッズで最終確認してください"
    : "EV 1.25以上の候補なし。買わない日として成功扱いです。";

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
          <button className="active">Dashboard</button>
          <button>Results</button>
          <button>History</button>
          <button>Settings</button>
        </nav>
        <div className="guardrail">
          <ShieldCheck size={18} />
          <p>自動購入・自動投票・ログイン保存・投票サイト操作は実装しません。</p>
        </div>
      </aside>

      <main className="main">
        <header className="hero">
          <div>
            <p className="eyebrow">PHASE 1 MVP / LOCAL DATA FIRST</p>
            <h2>{headline}</h2>
            <p>{headlineSub}</p>
          </div>
          <div className="systemBadge">
            <span>EV target</span>
            <strong>{DEFAULT_RULE.targetEv.toFixed(2)}</strong>
          </div>
        </header>

        <section className="metrics" aria-label="today summary">
          <Metric icon={<Bell size={18} />} label="BUY候補" value={buyRows.length.toString()} />
          <Metric icon={<Activity size={18} />} label="WATCH" value={watchRows.length.toString()} />
          <Metric icon={<Database size={18} />} label="SKIP" value={skipRows.length.toString()} />
          <Metric label="購入予定額" value={`${totalPlanned.toLocaleString()}円`} />
          <Metric label="本日の最大損失" value={`${DEFAULT_RULE.dailyBudgetYen.toLocaleString()}円`} />
        </section>

        <section className="section">
          <div className="sectionHead">
            <div>
              <h3>候補レース</h3>
              <p>BUY条件を満たした時だけ通知対象。WATCH/SKIPは記録のみ。</p>
            </div>
          </div>
          <div className="candidateGrid">
            {rows.map(({ candidate, decision }) => (
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
                <a className="officialLink" href={officialOddsUrl} target="_blank" rel="noopener noreferrer">
                  公式で確認して購入 <ExternalLink size={15} />
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="sectionHead">
            <div>
              <h3>結果取り込みプレビュー</h3>
              <p>kyotei24 raw HTML → normalized JSON → SQLite の保存先を想定。</p>
            </div>
          </div>
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
                {sampleResults.map((result) => (
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
        </section>
      </main>
    </div>
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
