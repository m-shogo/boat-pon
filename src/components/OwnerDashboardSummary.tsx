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

  const learning = snapshot.buyLearning;
  return (
    <section className="ownerDashboard" aria-label="Owner Dashboard">
      <div className={`ownerOverall owner-${snapshot.overall.status.toLowerCase()}`}>
        <div><p className="eyebrow">OWNER STATUS</p><h2>{snapshot.overall.status}</h2></div>
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

      <div className="ownerSectionHead"><h3>BUY Performance & Learning</h3><p>settled outcomeの安全な集計のみ。Current BUYは変更しません</p></div>
      {learning.status === "AVAILABLE" ? <>
        <div className="ownerGrid ownerBuyGrid">
          <OwnerCard label="Settled BUY" value={formatNumber(learning.performance.settled)} />
          <OwnerCard label="Hits" value={formatNumber(learning.performance.hits)} />
          <OwnerCard label="Misses" value={formatNumber(learning.performance.misses)} />
          <OwnerCard label="Hit rate" value={formatPct(learning.performance.hitRate)} />
          <OwnerCard label="ROI" value={formatRoi(learning.performance.roi)} />
          <OwnerCard label="ROI ex max-hit" value={formatRoi(learning.performance.roiExMax)} />
          <OwnerCard label="Recent hit rate" value={formatPct(learning.recent.hitRate)} />
          <OwnerCard label="Recent ROI" value={formatRoi(learning.recent.roi)} />
        </div>
        <div className="ownerSplit">
          <article className="ownerPanel ownerLearningPanel">
            <header><span>WHAT WE LEARNED</span><strong>{learning.learnings.length}</strong></header>
            {learning.learnings.length ? <ul className="ownerLearningList">{learning.learnings.map((item) => <li key={item.id}><div><strong>{item.title}</strong><span>{item.severity}</span></div><p>{item.summary}</p><small>evidence n={item.evidenceCount}</small></li>)}</ul> : <p className="ownerClear">No dominant learning signal</p>}
          </article>
          <article className="ownerPanel ownerLearningPanel">
            <header><span>FAILURE PATTERNS</span><strong>{learning.failurePatterns.length}</strong></header>
            {learning.failurePatterns.length ? <ul className="ownerLearningList">{learning.failurePatterns.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span>{item.count}</span></div><p>{item.share == null ? "share unavailable" : `${(item.share * 100).toFixed(1)}% of settled misses`}</p></li>)}</ul> : <p className="ownerClear">No classified failure pattern</p>}
            <div className="ownerNext"><span>IMPROVEMENT RESEARCH</span>{learning.researchCandidates.length ? <ul>{learning.researchCandidates.map((item) => <li key={item.id}><strong>{item.title}</strong><br/><small>{item.reason} / production auto-change: OFF</small></li>)}</ul> : <p>継続観測</p>}</div>
          </article>
        </div>
      </> : <article className="ownerPanel"><header><span>BUY LEARNING</span><strong>NOT_AVAILABLE</strong></header><p className="ownerClear">private decision/outcome evidenceが利用できないため、成績や学びを推測表示しません。</p></article>}

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
        {snapshot.n2Tasks.map((task) => <article className="ownerTask" key={task.taskId}><div><code>{task.taskId}</code><span>{task.status}</span></div><h4>{task.label}</h4><p>Attempts <strong>{task.attemptCount}</strong> / {task.maxAttempts}</p></article>)}
      </div>

      <div className="ownerSectionHead"><h3>Recent Research Progress</h3><p>commit一覧ではなく改善内容を要約</p></div>
      <div className="ownerProgressList">
        {snapshot.recentProgress.length ? snapshot.recentProgress.map((item) => <article key={`${item.sha}-${item.committedAt}`}><div><strong>{item.title}</strong><code>{item.sha}</code></div><p>{item.summary}</p><time>{formatDate(item.committedAt)}</time></article>) : <p className="ownerClear">Recent progress is NOT_AVAILABLE</p>}
      </div>
    </section>
  );
}

function OwnerCard({ label, value }: { label: string; value: string }) { return <div className="ownerCard"><span>{label}</span><strong>{value}</strong></div>; }
function formatDate(value: string | null): string { if (!value) return "NOT_AVAILABLE"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "NOT_AVAILABLE" : date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }); }
function formatNumber(value: number | null): string { return value == null ? "NOT_AVAILABLE" : value.toLocaleString("ja-JP"); }
function formatPct(value: number | null): string { return value == null ? "NOT_AVAILABLE" : `${(value * 100).toFixed(1)}%`; }
function formatRoi(value: number | null): string { return value == null ? "NOT_AVAILABLE" : `${(value * 100).toFixed(1)}%`; }
