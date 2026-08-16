import type { OwnerDashboardSnapshot } from "../presentation/ownerDashboardSnapshot";
import type { OwnerBuyRoiBootstrapInterval, OwnerBuyWilsonInterval } from "../presentation/ownerBuyEvidenceDiagnostics";

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
  const evidence = snapshot.buyEvidence;
  const marketHealth = snapshot.buyMarketHealth;
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

      <div className="ownerSectionHead"><h3>BUY Performance & Learning</h3><p>公式settlement払戻を100円unit-stakeへ正規化した集計。実stake損益ではなく、Current BUYは自動変更しません</p></div>
      {learning.status === "AVAILABLE" ? <>
        <div className="ownerGrid ownerBuyGrid">
          <OwnerCard label="Settled BUY" value={formatNumber(learning.performance.settled)} />
          <OwnerCard label="Hits" value={formatNumber(learning.performance.hits)} />
          <OwnerCard label="Misses" value={formatNumber(learning.performance.misses)} />
          <OwnerCard label="Hit rate" value={formatPct(learning.performance.hitRate)} />
          <OwnerCard label="Unit-stake ROI" value={formatRoi(learning.performance.roi)} />
          <OwnerCard label="ROI ex max-hit" value={formatRoi(learning.performance.roiExMax)} />
          <OwnerCard label="Recent hit rate" value={formatPct(learning.recent.hitRate)} />
          <OwnerCard label="Recent unit-stake ROI" value={formatRoi(learning.recent.roi)} />
        </div>

        {evidence.status === "AVAILABLE" && evidence.patternSupport && evidence.hitRateUncertainty && evidence.roiUncertainty && evidence.tailStability ? <>
          <div className="ownerSectionHead"><h3>Outcome Evidence Maturity</h3><p>成功/失敗を断定する前のsupport・不確実性・時系列再現性。production auto-change: OFF</p></div>
          <div className="ownerGrid ownerBuyGrid">
            <OwnerCard label="Pattern support" value={formatPatternSupport(evidence.patternSupport.status)} />
            <OwnerCard label="Supported contrasts" value={String(evidence.patternSupport.supportedContrastCount)} />
            <OwnerCard label="Supported dimensions" value={String(evidence.patternSupport.supportedDimensionCount)} />
            <OwnerCard label="Hit rate 95%" value={formatInterval(evidence.hitRateUncertainty.performance)} />
            <OwnerCard label="Recent hit rate 95%" value={formatInterval(evidence.hitRateUncertainty.recent)} />
            <OwnerCard label="ROI 95%" value={formatRoiInterval(evidence.roiUncertainty.performance.interval)} />
            <OwnerCard label="Recent ROI 95%" value={formatRoiInterval(evidence.roiUncertainty.recent.interval)} />
            <OwnerCard label="ROI evidence" value={formatRoiClassification(evidence.roiUncertainty.performance.interval?.classification ?? null)} />
            <OwnerCard label="Tail stability" value={formatTailStatus(evidence.tailStability.status)} />
          </div>
          <div className="ownerSplit">
            <article className="ownerPanel">
              <header><span>PATTERN SCREENING</span><strong>{evidence.patternSupport.patternSignalCount}</strong></header>
              <dl>
                <div><dt>Reason</dt><dd>{formatNoSignalReason(evidence.patternSupport.noSignalReason)}</dd></div>
                <div><dt>Support floor</dt><dd>{evidence.patternSupport.minimumSettledPerSide} vs {evidence.patternSupport.minimumSettledPerSide}</dd></div>
                <div><dt>Valid segment cells</dt><dd>{evidence.patternSupport.validSegmentCount}</dd></div>
                <div><dt>Segment-side eligible</dt><dd>{evidence.patternSupport.segmentSideEligibleCount}</dd></div>
                <div><dt>Supported contrasts</dt><dd>{evidence.patternSupport.supportedContrastCount}</dd></div>
                <div><dt>Global additional settled</dt><dd>{evidence.patternSupport.globalAdditionalSettledForAnyContrast}</dd></div>
              </dl>
            </article>
            <article className="ownerPanel">
              <header><span>TAIL / UNCERTAINTY</span><strong>{formatTailStatus(evidence.tailStability.status)}</strong></header>
              <dl>
                <div><dt>Independent windows</dt><dd>{evidence.tailStability.recentSettled} / {evidence.tailStability.priorSettled}</dd></div>
                <div><dt>Recent max-hit ROI gap</dt><dd>{formatRoiGap(evidence.tailStability.recentTailGap)}</dd></div>
                <div><dt>Prior max-hit ROI gap</dt><dd>{formatRoiGap(evidence.tailStability.priorTailGap)}</dd></div>
                <div><dt>Overall hit-rate interval</dt><dd>{formatIntervalLong(evidence.hitRateUncertainty.performance)}</dd></div>
                <div><dt>Recent hit-rate interval</dt><dd>{formatIntervalLong(evidence.hitRateUncertainty.recent)}</dd></div>
                <div><dt>Overall ROI interval</dt><dd>{formatRoiIntervalLong(evidence.roiUncertainty.performance.interval)}</dd></div>
                <div><dt>Recent ROI interval</dt><dd>{formatRoiIntervalLong(evidence.roiUncertainty.recent.interval)}</dd></div>
              </dl>
            </article>
          </div>
        </> : <article className="ownerPanel"><header><span>OUTCOME EVIDENCE</span><strong>NOT_AVAILABLE</strong></header><p className="ownerClear">検証済みsupport / uncertainty / temporal evidenceがないため推測表示しません。</p></article>}

        {marketHealth.status === "AVAILABLE" && marketHealth.probability && marketHealth.evRealization && marketHealth.priceReadiness ? <>
          <div className="ownerSectionHead"><h3>BUY Market Health</h3><p>BUY判定に実際に使った確率・stored EV・価格検証readinessを同一cohortで照合。個別オッズは非公開、production auto-change: OFF</p></div>
          <div className="ownerGrid ownerBuyGrid">
            <OwnerCard label="BUY p / actual" value={`${formatPct(marketHealth.probability.decisionEffectiveHitRate)} / ${formatPct(marketHealth.probability.observedHitRate)}`} />
            <OwnerCard label="Calibration" value={formatCalibration(marketHealth.probability.classification)} />
            <OwnerCard label="Calibration stability" value={formatCalibrationStability(marketHealth.probability.stability)} />
            <OwnerCard label="Feature p" value={formatPct(marketHealth.probability.featureAdjustedHitRate)} />
            <OwnerCard label="Empirical retention" value={formatPct(marketHealth.probability.featureToDecisionRetention)} />
            <OwnerCard label="Stored EV avg" value={formatRoi(marketHealth.evRealization.performance.averageStoredEv)} />
            <OwnerCard label="EV realized / expected" value={formatPct(marketHealth.evRealization.performance.realizedToExpectedRatio)} />
            <OwnerCard label="EV evidence" value={formatExpectedEvClassification(marketHealth.evRealization.performance.classification)} />
            <OwnerCard label="Price evidence" value={formatPriceReadiness(marketHealth.priceReadiness.performance)} />
          </div>
          <div className="ownerSplit">
            <article className="ownerPanel">
              <header><span>PROBABILITY PIPELINE</span><strong>{formatCalibrationStability(marketHealth.probability.stability)}</strong></header>
              <dl>
                <div><dt>Feature-adjusted p</dt><dd>{formatPct(marketHealth.probability.featureAdjustedHitRate)}</dd></div>
                <div><dt>Decision-effective p</dt><dd>{formatPct(marketHealth.probability.decisionEffectiveHitRate)}</dd></div>
                <div><dt>Observed hit rate</dt><dd>{formatPct(marketHealth.probability.observedHitRate)}</dd></div>
                <div><dt>Calibration bias</dt><dd>{formatSignedPctPoint(marketHealth.probability.calibrationBias)}</dd></div>
                <div><dt>Empirical retention</dt><dd>{formatPct(marketHealth.probability.featureToDecisionRetention)}</dd></div>
              </dl>
            </article>
            <article className="ownerPanel">
              <header><span>EV / PRICE READINESS</span><strong>{formatExpectedEvClassification(marketHealth.evRealization.performance.classification)}</strong></header>
              <dl>
                <div><dt>Stored EV / realized ROI</dt><dd>{formatRoi(marketHealth.evRealization.performance.averageStoredEv)} / {formatRoi(marketHealth.evRealization.performance.realizedRoi)}</dd></div>
                <div><dt>Realized / expected</dt><dd>{formatPct(marketHealth.evRealization.performance.realizedToExpectedRatio)}</dd></div>
                <div><dt>Recent realized / expected</dt><dd>{formatPct(marketHealth.evRealization.recent.realizedToExpectedRatio)}</dd></div>
                <div><dt>Price evidence support</dt><dd>{formatPriceReadiness(marketHealth.priceReadiness.performance)}</dd></div>
                <div><dt>Recent price support</dt><dd>{formatPriceReadiness(marketHealth.priceReadiness.recent)}</dd></div>
              </dl>
            </article>
          </div>
        </> : <article className="ownerPanel"><header><span>BUY MARKET HEALTH</span><strong>NOT_AVAILABLE</strong></header><p className="ownerClear">確率・EV・価格readinessの同一cohort検証が成立していないため推測表示しません。</p></article>}

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
function formatRoiGap(value: number | null): string { return value == null ? "NOT_AVAILABLE" : `${(value * 100).toFixed(1)} pt`; }
function formatSignedPctPoint(value: number): string { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)} pt`; }
function formatInterval(value: OwnerBuyWilsonInterval): string { return value.lower == null || value.upper == null ? "NOT_AVAILABLE" : `${(value.lower * 100).toFixed(1)}–${(value.upper * 100).toFixed(1)}%`; }
function formatIntervalLong(value: OwnerBuyWilsonInterval): string { return value.pointEstimate == null ? "NOT_AVAILABLE" : `${formatPct(value.pointEstimate)} / 95% ${formatInterval(value)}`; }
function formatRoiInterval(value: OwnerBuyRoiBootstrapInterval | null): string { return value == null ? "NOT_AVAILABLE" : `${(value.lower * 100).toFixed(1)}–${(value.upper * 100).toFixed(1)}%`; }
function formatRoiIntervalLong(value: OwnerBuyRoiBootstrapInterval | null): string { return value == null ? "NOT_AVAILABLE" : `${formatRoi(value.pointEstimate)} / 95% ${formatRoiInterval(value)} / ${formatRoiClassification(value.classification)}`; }
function formatRoiClassification(value: OwnerBuyRoiBootstrapInterval["classification"] | null): string {
  if (value === "ABOVE_BREAK_EVEN") return "95%区間も損益分岐超え";
  if (value === "BELOW_BREAK_EVEN") return "95%区間も損益分岐未満";
  if (value === "CROSSES_BREAK_EVEN") return "損益分岐をまたぐ";
  return "NOT_AVAILABLE";
}
function formatPatternSupport(value: NonNullable<OwnerDashboardSnapshot["buyEvidence"]["patternSupport"]>["status"]): string {
  if (value === "INSUFFICIENT_GLOBAL_SUPPORT") return "GLOBAL SUPPORT不足";
  if (value === "NO_SUPPORTED_CONTRAST") return "比較cohort未成立";
  return "比較可能";
}
function formatNoSignalReason(value: NonNullable<OwnerDashboardSnapshot["buyEvidence"]["patternSupport"]>["noSignalReason"]): string {
  if (value === null) return "signalあり";
  if (value === "INSUFFICIENT_GLOBAL_SUPPORT") return "全体母数不足";
  if (value === "NO_SUPPORTED_CONTRAST") return "segment/complementの両側support不足";
  return "比較可能だがROI差が閾値未満";
}
function formatTailStatus(value: NonNullable<OwnerDashboardSnapshot["buyEvidence"]["tailStability"]>["status"]): string {
  if (value === "PERSISTENT_TAIL_DEPENDENCE") return "継続依存";
  if (value === "RECENT_TAIL_DEPENDENCE") return "直近のみ";
  if (value === "PRIOR_TAIL_DEPENDENCE") return "過去のみ";
  if (value === "NO_TAIL_DEPENDENCE_SIGNAL") return "反復なし";
  return "support不足";
}
function formatCalibration(value: NonNullable<OwnerDashboardSnapshot["buyMarketHealth"]["probability"]>["classification"]): string {
  if (value === "OVERCONFIDENT") return "過大推定";
  if (value === "UNDERCONFIDENT") return "過小推定";
  return "±5pt内";
}
function formatCalibrationStability(value: NonNullable<OwnerDashboardSnapshot["buyMarketHealth"]["probability"]>["stability"]): string {
  if (value === "STABLE_WITHIN_5PT") return "2窓とも±5pt内";
  if (value === "PERSISTENT_OVERCONFIDENCE") return "過大推定が継続";
  if (value === "PERSISTENT_UNDERCONFIDENCE") return "過小推定が継続";
  if (value === "CALIBRATION_REGIME_CHANGED") return "window間で変化";
  return "support不足";
}
function formatExpectedEvClassification(value: NonNullable<OwnerDashboardSnapshot["buyMarketHealth"]["evRealization"]>["performance"]["classification"]): string {
  if (value === "BELOW_EXPECTED") return "95%区間も期待EV未満";
  if (value === "ABOVE_EXPECTED") return "95%区間も期待EV超え";
  return "期待EVを95%区間がまたぐ";
}
function formatPriceReadiness(value: NonNullable<OwnerDashboardSnapshot["buyMarketHealth"]["priceReadiness"]>["performance"]): string {
  if (value.status === "AVAILABLE") return `${value.hits}/${value.minimumHits} hits / 比較可能`;
  return `${value.hits}/${value.minimumHits} hits / あと${value.missingHits}`;
}
