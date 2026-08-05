import type { ReactNode } from "react";
import {
  type PublicDashboardSnapshot,
  type PublicResearchStatus,
} from "../presentation/publicSnapshot";
import type { PublicSnapshotFreshness } from "../presentation/publicSnapshotTransport";
import { GlossaryTip } from "./GlossaryTip";
import "../public-dashboard.css";

export function ResearchCommandCenter({
  snapshot = null,
  observedFreshness = snapshot?.status.snapshotFreshness ?? "NOT_AVAILABLE",
  loading = false,
  errors = [],
  warnings = [],
}: {
  snapshot?: PublicDashboardSnapshot | null;
  observedFreshness?: PublicSnapshotFreshness;
  loading?: boolean;
  errors?: string[];
  warnings?: string[];
}) {
  if (loading) {
    return (
      <section className="researchCommandCenter" aria-label="Research Command Center" aria-busy="true">
        <header className="commandCenterHeader">
          <div>
            <p className="eyebrow">SANITIZED PUBLIC SNAPSHOT</p>
            <h2>Research Command Center</h2>
          </div>
          <StatusBadge status="NOT_AVAILABLE" />
        </header>
        <div className="commandCenterNotice" role="status">
          公開snapshotのschema・完全性・鮮度を検証しています。
        </div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="researchCommandCenter" aria-label="Research Command Center">
        <header className="commandCenterHeader">
          <div>
            <p className="eyebrow">SANITIZED PUBLIC SNAPSHOT</p>
            <h2>Research Command Center</h2>
          </div>
          <StatusBadge status="NOT_AVAILABLE" />
        </header>
        <div className="commandCenterNotice danger" role="alert">
          {publicSnapshotMessage(errors[0])}
          値を推測せず、検証済みsnapshotが取得できるまでNOT_AVAILABLEとして扱います。
        </div>
      </section>
    );
  }

  return (
    <section className="researchCommandCenter" aria-label="Research Command Center">
      <header className="commandCenterHeader">
        <div>
          <p className="eyebrow">SANITIZED PUBLIC SNAPSHOT / READ-ONLY</p>
          <h2>Research Command Center</h2>
          <p>研究計算を再実行せず、公開可能な状態・依存関係・データ品質だけを表示します。</p>
        </div>
        <StatusBadge status={snapshot.status.readiness} />
      </header>

      {observedFreshness !== "FRESH" && (
        <div className="commandCenterNotice warn" role="status">
          snapshot freshness: <strong>{observedFreshness}</strong>。古い値を最新値として扱いません。
        </div>
      )}

      {warnings.length > 0 && (
        <div className="commandCenterNotice warn" role="status">
          snapshot内の鮮度表示とブラウザ側の観測が一致しないため、ブラウザ側の判定を優先しています。
        </div>
      )}

      <div className="commandCenterMeta" aria-label="research status summary">
        <StatusCard label="Current Phase" value={snapshot.status.currentPhase} />
        <StatusCard label="Last run" value={formatDateTime(snapshot.status.lastRunAt)} />
        <StatusCard label="Next task" value={snapshot.status.nextTask} />
        <StatusCard label={<GlossaryTip termKey="runner" label="Runner" />} value={snapshot.status.runner} />
        <StatusCard label="Data as of" value={formatDateTime(snapshot.dataAsOf)} />
        <StatusCard label="Model version" value={snapshot.modelVersion} />
      </div>

      <div className="commandCenterSectionHead">
        <div>
          <h3>Task dependency pipeline</h3>
          <p>PASS・READY・BLOCKEDを依存関係と一緒に読みます。</p>
        </div>
        <GlossaryTip termKey="queueState" />
      </div>
      <div className="pipelineGrid">
        {snapshot.pipeline.length > 0 ? snapshot.pipeline.map((task) => (
          <article className="pipelineCard" key={task.taskId}>
            <div className="pipelineCardTop">
              <code>{task.taskId}</code>
              <StatusBadge status={task.status} />
            </div>
            <h4>{task.label}</h4>
            <p><strong>Dependencies:</strong> {task.dependencies.length ? task.dependencies.join(", ") : "NONE"}</p>
            <p><strong>Evidence:</strong> {task.evidence.length ? task.evidence.join(", ") : "NOT_AVAILABLE"}</p>
          </article>
        )) : <EmptyState label="Pipeline" />}
      </div>

      <div className="commandCenterSectionHead">
        <div>
          <h3>Research registries</h3>
          <p>存在しない値や未取得値を0として表示しません。</p>
        </div>
      </div>
      <div className="registryGrid">
        <RegistryCard label={<GlossaryTip termKey="experiment" />} value={snapshot.registries.experiments} />
        <RegistryCard label={<GlossaryTip termKey="discovery" />} value={snapshot.registries.discoveries} />
        <RegistryCard label={<GlossaryTip termKey="rejection" />} value={snapshot.registries.rejections} />
      </div>

      <div className="commandCenterSectionHead">
        <div>
          <h3>Data safety and comparability</h3>
          <p>研究結果の前に、未来情報・未使用データ・比較母集団を確認します。</p>
        </div>
      </div>
      <div className="qualityGrid">
        <QualityCard label="Coverage" status={snapshot.dataQuality.coverageStatus} />
        <QualityCard label={<GlossaryTip termKey="pit" />} status={snapshot.dataQuality.pitStatus} />
        <QualityCard label={<GlossaryTip termKey="holdout" />} status={snapshot.dataQuality.holdoutStatus} />
        <QualityCard label={<GlossaryTip termKey="commonCohort" />} status={snapshot.dataQuality.commonCohortStatus} />
      </div>

      {snapshot.metrics.length === 0 ? (
        <EmptyState label="Public aggregate metrics" />
      ) : (
        <div className="publicMetricGrid">
          {snapshot.metrics.map((metric) => (
            <article key={metric.id} className="publicMetricCard">
              <span>{metric.label}</span>
              <strong>{metric.value ?? "NOT_AVAILABLE"}{metric.value != null && metric.unit ? metric.unit : ""}</strong>
              <small>{metric.basis} / n={metric.sampleSize ?? "NOT_AVAILABLE"}</small>
            </article>
          ))}
        </div>
      )}

      {snapshot.dataQuality.notes.length > 0 && (
        <ul className="commandCenterNotes">
          {snapshot.dataQuality.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
    </section>
  );
}

function StatusCard({ label, value }: { label: ReactNode; value: string | null }) {
  return <div className="commandStatusCard"><span>{label}</span><strong>{value ?? "NOT_AVAILABLE"}</strong></div>;
}

function RegistryCard({ label, value }: { label: ReactNode; value: number | null }) {
  return <div className="registryCard"><span>{label}</span><strong>{value ?? "NOT_AVAILABLE"}</strong></div>;
}

function QualityCard({ label, status }: { label: ReactNode; status: PublicResearchStatus }) {
  return <div className="qualityCard"><span>{label}</span><StatusBadge status={status} /></div>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="commandEmpty"><strong>{label}</strong><span>NOT_AVAILABLE</span></div>;
}

function StatusBadge({ status }: { status: PublicResearchStatus }) {
  return <span className={`commandStatus status-${status.toLowerCase().replaceAll("_", "-")}`}>{status}</span>;
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "NOT_AVAILABLE";
  return parsed.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function publicSnapshotMessage(error: string | undefined): string {
  if (!error) return "公開snapshotはまだ生成されていません。";
  if (error.startsWith("HTTP_")) return "公開snapshotを取得できませんでした。";
  if (error === "NETWORK_ERROR") return "公開snapshotへの接続に失敗しました。";
  if (error === "FUTURE_DATA_AS_OF") return "未来時刻のsnapshotを拒否しました。";
  if (error === "INVALID_OR_UNVERIFIED_SNAPSHOT") return "公開snapshotのschemaまたは完全性検証に失敗しました。";
  return "公開snapshotを安全に読み込めませんでした。";
}
