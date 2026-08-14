import type { OwnerDashboardSnapshot } from "../presentation/ownerDashboardSnapshot";

export function OwnerDashboardSummary({ snapshot }: { snapshot: OwnerDashboardSnapshot | null }) {
  if (!snapshot) {
    return (
      <section className="ownerDashboard" aria-label="Owner Dashboard">
        <div className="ownerOverall owner-unknown">
          <div><p className="eyebrow">OWNER STATUS</p><h2>UNKNOWN</h2></div>
          <p>検証済みOwner snapshotがありません。推測値は表示しません。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ownerDashboard" aria-label="Owner Dashboard">
      <div className={`ownerOverall owner-${snapshot.overall.status.toLowerCase()}`}>
        <div>
          <p className="eyebrow">OWNER STATUS</p>
          <h2>{snapshot.overall.status}</h2>
        </div>
        <p>{snapshot.overall.reason}</p>
      </div>

      <div className="ownerGrid ownerGitGrid">
        <OwnerCard label="Canonical branch" value={snapshot.git.canonicalBranch} />
        <OwnerCard label="Main SHA" value={snapshot.git.mainSha.slice(0, 8)} />
        <OwnerCard label="CI" value={snapshot.git.ciStatus} />
        <OwnerCard label="Open PR" value={String(snapshot.git.openPrCount)} />
        <OwnerCard label="Git" value={snapshot.git.cleanliness} />
        <OwnerCard label="Main updated" value={formatDate(snapshot.git.updatedAt)} />
      </div>

      <div className="ownerSplit">
        <article className="ownerPanel">
          <header><span>HOURLY RESEARCH</span><strong>{snapshot.hourlyResearch.lastResult}</strong></header>
          <dl>
            <div><dt>Last run</dt><dd>{formatDate(snapshot.hourlyResearch.lastRunAt)}</dd></div>
            <div><dt>What changed</dt><dd>{snapshot.hourlyResearch.changedSummary}</dd></div>
            <div><dt>Blocker</dt><dd>{snapshot.hourlyResearch.blocker ?? "No active blockers"}</dd></div>
            <div><dt>Next safe action</dt><dd>{snapshot.hourlyResearch.nextSafeAction ?? "NOT_AVAILABLE"}</dd></div>
          </dl>
        </article>

        <article className="ownerPanel">
          <header><span>BLOCKERS</span><strong>{snapshot.blockers.length}</strong></header>
          {snapshot.blockers.length ? <ul>{snapshot.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="ownerClear">No active blockers</p>}
          <div className="ownerNext"><span>NEXT SAFE ACTION</span><p>{snapshot.nextSafeAction ?? "NOT_AVAILABLE"}</p></div>
        </article>
      </div>

      <div className="ownerSectionHead"><h3>N2 Research State</h3><p>authorityに存在するattempt値のみ表示</p></div>
      <div className="ownerTaskGrid">
        {snapshot.n2Tasks.map((task) => (
          <article className="ownerTask" key={task.taskId}>
            <div><code>{task.taskId}</code><span>{task.status}</span></div>
            <h4>{task.label}</h4>
            <p>Attempts <strong>{task.attemptCount}</strong> / {task.maxAttempts}</p>
          </article>
        ))}
      </div>

      <div className="ownerSectionHead"><h3>Recent Research Progress</h3><p>commit一覧ではなく改善内容を要約</p></div>
      <div className="ownerProgressList">
        {snapshot.recentProgress.length ? snapshot.recentProgress.map((item) => (
          <article key={`${item.sha}-${item.committedAt}`}>
            <div><strong>{item.title}</strong><code>{item.sha}</code></div>
            <p>{item.summary}</p><time>{formatDate(item.committedAt)}</time>
          </article>
        )) : <p className="ownerClear">Recent progress is NOT_AVAILABLE</p>}
      </div>
    </section>
  );
}

function OwnerCard({ label, value }: { label: string; value: string }) { return <div className="ownerCard"><span>{label}</span><strong>{value}</strong></div>; }
function formatDate(value: string | null): string { if (!value) return "NOT_AVAILABLE"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "NOT_AVAILABLE" : date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }); }
