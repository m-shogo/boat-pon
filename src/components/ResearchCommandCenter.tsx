import fixture from "../presentation/fixtures/public-dashboard-snapshot-v1.json";
import {
  validatePublicDashboardSnapshot,
  type PublicDashboardSnapshot,
  type PublicResearchStatus,
} from "../presentation/publicSnapshot";
import { GlossaryTip } from "./GlossaryTip";
import "../public-dashboard.css";

const fixtureValidation = validatePublicDashboardSnapshot(fixture);
const sanitizedFixture = fixtureValidation.ok ? fixture as PublicDashboardSnapshot : null;

export function ResearchCommandCenter({
  snapshot = sanitizedFixture,
}: {
  snapshot?: PublicDashboardSnapshot | null;
}) {
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
          公開snapshotを検証できません。値を推測せず、last-known-goodまたはNOT_AVAILABLEを表示します。
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

      {snapshot.status.snapshotFreshness !== "FRESH" && (
        <div className="commandCenterNotice warn" role="status">
          snapshot freshness: <strong>{snapshot.status.snapshotFreshness}</strong>。古い値を最新値として扱わないでください。
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

function StatusCard({ label, value }: { label: React.ReactNode; value: string | null }) {
  return <div className="commandStatusCard"><span>{label}</span><strong>{value ?? "NOT_AVAILABLE"}</strong></div>;
}

function RegistryCard({ label, value }: { label: React.ReactNode; value: number | null }) {
  return <div className="registryCard"><span>{label}</span><strong>{value ?? "NOT_AVAILABLE"}</strong></div>;
}

function QualityCard({ label, status }: { label: React.ReactNode; status: PublicResearchStatus }) {
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
