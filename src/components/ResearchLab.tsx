import { useEffect, useMemo, useState } from "react";
import { fetchResearchHypotheses, type ResearchHypothesisRegistry } from "../api";
import {
  renderHypothesisBoard,
  renderLiveCandidateHealth,
  type FableHypothesisCard,
} from "../renderers/fable-fsharp/generated/Renderer.js";

const STATUS_LABEL: Record<string, string> = {
  "testing-historical": "履歴検証中",
  "testing-ready": "検証準備済み",
  "tested-historical": "履歴検証済み",
  monitor: "監視中",
  "waiting-data": "データ待ち",
  backlog: "未着手",
  frozen: "凍結",
  rejected: "棄却",
  "closed-rejected": "検証終了・棄却",
  secondary: "次点",
};

function isRejectedStatus(status: string) {
  return status.includes("rejected") || status === "frozen";
}

export function ResearchLab({ candidateRows, racePrograms }: { candidateRows: number; racePrograms: number }) {
  const [registry, setRegistry] = useState<ResearchHypothesisRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("active");

  useEffect(() => {
    fetchResearchHypotheses().then(setRegistry).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);

  const board = useMemo(() => registry ? renderHypothesisBoard(registry) : null, [registry]);
  const candidateHealth = useMemo(
    () => renderLiveCandidateHealth({ candidateRows, racePrograms }),
    [candidateRows, racePrograms],
  );
  const cards = useMemo(() => {
    if (!board) return [];
    if (status === "all") return board.cards;
    if (status === "rejected") return board.cards.filter((card) => isRejectedStatus(card.status));
    return board.cards.filter((card) => !isRejectedStatus(card.status));
  }, [board, status]);

  if (error) return <div className="errorBox">研究レジストリを読み込めません: {error}</div>;
  if (!board) return <div className="loading">Fable Research Labを読み込み中...</div>;

  return (
    <section className="researchLab" aria-label="Fable Research Lab">
      <header className="researchLabHeader">
        <div>
          <p className="eyebrow">REAL FABLE / READ-ONLY RESEARCH VIEW</p>
          <h2>仮説を増やすより、弱い仮説を早く捨てる</h2>
          <p>F#で研究レジストリを表示用に変換。ROI・採否・設定は再計算せず、既存の根拠とブロック理由を見える化します。</p>
        </div>
        <div className="researchLabFilters" role="group" aria-label="仮説フィルター">
          <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>継続中</button>
          <button className={status === "rejected" ? "active" : ""} onClick={() => setStatus("rejected")}>棄却・凍結</button>
          <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>すべて</button>
        </div>
      </header>

      <div className="researchLabSummary">
        <Summary label="仮説総数" value={board.summary.total} />
        <Summary label="監視・検証中" value={board.summary.monitoring} />
        <Summary label="採用可能" value={board.summary.adoptionAllowed} />
        <Summary label="採用ブロック" value={board.summary.blocked} />
        <Summary label="棄却" value={board.summary.rejected} />
      </div>

      <div className={`candidateMultiplicityAudit tone-${candidateHealth.tone}`}>
        <div>
          <span>候補多重度監査</span>
          <strong>{candidateHealth.rowsPerRace.toFixed(1)} 行 / レース</strong>
        </div>
        <p>
          candidate {candidateHealth.candidateRows.toLocaleString()}行 / 番組 {candidateHealth.racePrograms.toLocaleString()}レース。
          {candidateHealth.hasMultiplicity
            ? " 1レース複数候補が展開されています。live判定へ接続する前に、モデル最上位1件へ絞るpaper検証が必要です。"
            : " 候補行とレース数は1対1です。"}
        </p>
      </div>

      <div className="hypothesisGrid">
        {cards.map((card) => <HypothesisCard key={card.id} card={card} />)}
      </div>
      {cards.length === 0 && <p className="researchEmpty">該当する仮説はありません。</p>}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function HypothesisCard({ card }: { card: FableHypothesisCard }) {
  const gates = Object.entries(card.gateStatus ?? {});
  const metrics = Object.entries(card.lastKnownMetrics ?? {}).filter(([, value]) => typeof value === "number" || typeof value === "string");
  const readiness = Object.entries(card.dataReadiness ?? {});
  const requiredData = card.requiredData ?? [];

  return (
    <article className={`hypothesisCard tone-${card.tone}`}>
      <div className="hypothesisCardTop">
        <span className="hypothesisId">{card.id}</span>
        <span className="hypothesisStatus">{STATUS_LABEL[card.status] ?? card.status}</span>
        <span className="hypothesisPriority">P{card.priority}</span>
      </div>
      <h3>{card.name}</h3>
      <p>{card.description}</p>

      {gates.length > 0 && (
        <div className="gateGrid" aria-label="検証ゲート">
          {gates.map(([name, value]) => (
            <span key={name} className={value === true ? "gate-pass" : value === false ? "gate-fail" : "gate-pending"}>
              {value === true ? "✓" : value === false ? "×" : "…"} {humanize(name)}
            </span>
          ))}
        </div>
      )}

      {metrics.length > 0 && (
        <dl className="hypothesisMetrics">
          {metrics.slice(0, 8).map(([name, value]) => (
            <div key={name}><dt>{humanize(name)}</dt><dd>{String(value)}</dd></div>
          ))}
        </dl>
      )}

      {readiness.length > 0 && (
        <dl className="dataReadiness">
          {readiness.map(([name, value]) => (
            <div key={name}><dt>{humanize(name)}</dt><dd>{String(value)}</dd></div>
          ))}
        </dl>
      )}

      {requiredData.length > 0 && (
        <div className="requiredData">
          <strong>不足・追加確認データ</strong>
          <ul>{requiredData.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}

      {!card.adoptionAllowed && card.adoptionBlockReason && (
        <div className="adoptionBlock"><strong>採用できない理由</strong><p>{card.adoptionBlockReason}</p></div>
      )}
      {card.nextAction && <div className="nextResearchAction"><strong>次にやること</strong><p>{card.nextAction}</p></div>}
      {card.nextReviewTrigger && <p className="reviewTrigger">再確認: {card.nextReviewTrigger}</p>}
    </article>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}
