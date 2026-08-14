import { OwnerDashboardSummary } from "./OwnerDashboardSummary";
import { ResearchCommandCenter } from "./ResearchCommandCenter";
import { useOwnerDashboardSnapshot } from "./useOwnerDashboardSnapshot";
import { usePublicDashboardSnapshot } from "./usePublicDashboardSnapshot";
import { GLOSSARY_TERMS, type GlossaryTerm } from "../presentation/glossary";
import "../owner-dashboard.css";

const FEATURED_TERMS = [
  GLOSSARY_TERMS.roi,
  GLOSSARY_TERMS.hitRate,
  GLOSSARY_TERMS.ev,
  GLOSSARY_TERMS.calibration,
  GLOSSARY_TERMS.historical,
  GLOSSARY_TERMS.forward,
  GLOSSARY_TERMS.paperLive,
  GLOSSARY_TERMS.pit,
  GLOSSARY_TERMS.holdout,
  GLOSSARY_TERMS.commonCohort,
  GLOSSARY_TERMS.runner,
  GLOSSARY_TERMS.queueState,
];

export function PublicDashboardApp() {
  const ownerSnapshot = useOwnerDashboardSnapshot();
  const publicSnapshot = usePublicDashboardSnapshot();

  return (
    <div className="publicPortal">
      <header className="publicHeader">
        <a className="publicBrand" href="#top" aria-label="Boat Pon Owner Dashboard top">
          <span className="publicBrandMark" aria-hidden="true">BP</span>
          <span><strong>Boat Pon</strong><small>Owner Dashboard</small></span>
        </a>
        <nav aria-label="公開ダッシュボード">
          <a href="#owner">全体状態</a>
          <a href="#research">研究状態</a>
          <a href="#methodology">読み方</a>
          <a href="#safety">利用上の注意</a>
        </nav>
      </header>

      <main id="top">
        <section className="publicHero" aria-labelledby="public-title">
          <div className="publicHeroCopy">
            <p className="publicKicker">OWNER / READ-ONLY / SANITIZED</p>
            <h1 id="public-title">1画面で、<br />Boat Ponの今が分かる。</h1>
            <p className="publicHeroLead">
              Git・毎時Research・N2 task・blocker・次の安全な一手を、canonical authorityから生成した公開用read modelだけで確認します。
            </p>
            <div className="publicHeroBadges" aria-label="公開方針">
              <span>閲覧専用</span><span>自動投票なし</span><span>private odds非公開</span>
            </div>
          </div>
          <aside className="publicTrustPanel" aria-label="この画面が保証すること">
            <p className="publicPanelLabel">Owner Dashboard v1</p>
            <ul>
              <li>Dashboard自体を新しいauthorityにしません。</li>
              <li>attemptCount/maxAttemptsはqueue-state正本の実値だけを表示します。</li>
              <li>unknown/malformedは推測せずNOT_AVAILABLEへ倒します。</li>
              <li>Current BUY・LINE・production behaviorから分離します。</li>
              <li>公開artifactにsecret・private path・raw oddsを含めません。</li>
            </ul>
          </aside>
        </section>

        <section id="owner" className="publicSection" aria-labelledby="owner-title">
          <SectionHeading eyebrow="OWNER OVERVIEW" title="今の状態" description="正常か、毎時動いているか、何が進み、何が止まり、次に何をするかを最初に確認します。" />
          <OwnerDashboardSummary snapshot={ownerSnapshot.loading ? null : ownerSnapshot.snapshot} />
        </section>

        <section id="research" className="publicSection" aria-labelledby="research-title">
          <SectionHeading eyebrow="CURRENT RESEARCH STATE" title="研究の詳細" description="PIT・holdout・common cohortなど、公開可能な研究状態を既存sanitized snapshotから表示します。" />
          <ResearchCommandCenter snapshot={publicSnapshot.snapshot} source={publicSnapshot.source} observedFreshness={publicSnapshot.observedFreshness} loading={publicSnapshot.loading} errors={publicSnapshot.errors} warnings={publicSnapshot.warnings} />
        </section>

        <section id="methodology" className="publicSection publicMethodology" aria-labelledby="methodology-title">
          <SectionHeading eyebrow="HOW TO READ" title="数字を見る前に確認すること" description="ROIや的中率だけでは、再現性や安全性は判断できません。" />
          <div className="publicMethodGrid">
            <MethodCard title="Historical" status="探索" text="過去データで候補を探す段階。良い結果でも、そのまま今後の成績とは扱いません。" />
            <MethodCard title="Forward" status="確認" text="条件を固定した後に到着した新しいデータで、再現するかを確認します。" />
            <MethodCard title="Paper-live" status="運用検証" text="実際の時刻・取得失敗・オッズ変動を含めて判断しますが、資金は使いません。" />
            <MethodCard title="Holdout" status="最終確認" text="探索や調整に使わず封印したデータで、偶然の当たりを見抜きます。" />
          </div>
        </section>

        <section id="glossary" className="publicSection" aria-labelledby="glossary-title">
          <SectionHeading eyebrow="PLAIN-LANGUAGE GLOSSARY" title="難しい用語を、その場で理解する" description="用語だけを並べず、なぜ重要か・どう読むか・よくある誤解まで説明します。" />
          <div className="publicGlossaryGrid">{FEATURED_TERMS.map((term) => <GlossaryCard key={term.id} term={term} />)}</div>
        </section>

        <section id="safety" className="publicSection publicSafety" aria-labelledby="safety-title">
          <div><p className="publicKicker">RESPONSIBLE PLAY</p><h2 id="safety-title">研究結果は、利益を保証しません。</h2></div>
          <div className="publicSafetyCopy"><p>競艇は損失が発生する娯楽です。公開される指標は研究状態の説明であり、購入の勧誘・自動購入・資金配分の指示ではありません。</p><p>正確な購入候補、内部threshold、推奨stake、個人の購入履歴は公開画面へ含めません。</p></div>
        </section>
      </main>

      <footer className="publicFooter"><div><strong>Boat Pon Owner Dashboard</strong><p>canonical authority → sanitized derived snapshot → static UI。</p></div><p>Current BUY・LINE・Mac data planeとは分離されています。</p></footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="publicSectionHeading"><p className="publicKicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p></header>; }
function MethodCard({ title, status, text }: { title: string; status: string; text: string }) { return <article className="publicMethodCard"><div><h3>{title}</h3><span>{status}</span></div><p>{text}</p></article>; }
function GlossaryCard({ term }: { term: GlossaryTerm }) { return <article className="publicGlossaryCard"><h3>{term.label}</h3><p>{term.plainDescription}</p><dl><div><dt>なぜ重要？</dt><dd>{term.whyItMatters}</dd></div><div><dt>読み方</dt><dd>{term.howToRead}</dd></div><div><dt>よくある誤解</dt><dd>{term.commonMistake}</dd></div></dl></article>; }
