import { ResearchCommandCenter } from "./ResearchCommandCenter";
import { usePublicDashboardSnapshot } from "./usePublicDashboardSnapshot";
import { GLOSSARY_TERMS, type GlossaryTerm } from "../presentation/glossary";

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
  const publicSnapshot = usePublicDashboardSnapshot();

  return (
    <div className="publicPortal">
      <header className="publicHeader">
        <a className="publicBrand" href="#top" aria-label="Boat Pon Research Dashboard top">
          <span className="publicBrandMark" aria-hidden="true">BP</span>
          <span><strong>Boat Pon</strong><small>Research Dashboard</small></span>
        </a>
        <nav aria-label="公開ダッシュボード">
          <a href="#research">研究状態</a>
          <a href="#methodology">読み方</a>
          <a href="#glossary">用語集</a>
          <a href="#safety">利用上の注意</a>
        </nav>
      </header>

      <main id="top">
        <section className="publicHero" aria-labelledby="public-title">
          <div className="publicHeroCopy">
            <p className="publicKicker">READ-ONLY / SANITIZED / RESEARCH TRANSPARENCY</p>
            <h1 id="public-title">当たった結果より、<br />再現できる根拠を公開する。</h1>
            <p className="publicHeroLead">
              Boat Ponは、予想を断定して販売する画面ではありません。研究の進捗、比較できる母集団、
              未来情報の混入防止、未使用データでの確認状況を、公開可能な範囲だけで見える化します。
            </p>
            <div className="publicHeroBadges" aria-label="公開方針">
              <span>公開画面は閲覧専用</span>
              <span>自動投票なし</span>
              <span>正確なBUY候補は非公開</span>
            </div>
          </div>
          <aside className="publicTrustPanel" aria-label="この画面が保証すること">
            <p className="publicPanelLabel">この画面の約束</p>
            <ul>
              <li>検証できない値を0や最新値として補完しません。</li>
              <li>署名とschemaを確認できないsnapshotは表示しません。</li>
              <li>Current BUYやLINEの判断経路から完全に分離します。</li>
              <li>公開サイトが停止しても日々の運用へ影響しません。</li>
            </ul>
          </aside>
        </section>

        <section className="publicPrinciples" aria-label="重要な読み方">
          <Principle number="01" title="結果より母集団" text="同じ期間・同じ対象で比較できるcommon cohortを優先します。" />
          <Principle number="02" title="未来情報を遮断" text="判断時点で利用可能だった情報だけを使うPITを確認します。" />
          <Principle number="03" title="未確認は未確認" text="未取得・未実行・不足サンプルを成功や0件へ置き換えません。" />
        </section>

        <section id="research" className="publicSection" aria-labelledby="research-title">
          <SectionHeading
            eyebrow="CURRENT RESEARCH STATE"
            title="研究の現在地"
            description="taskの依存関係、runner、PIT、holdout、common cohortを一つの公開snapshotから表示します。"
          />
          <ResearchCommandCenter
            snapshot={publicSnapshot.snapshot}
            observedFreshness={publicSnapshot.observedFreshness}
            loading={publicSnapshot.loading}
            errors={publicSnapshot.errors}
            warnings={publicSnapshot.warnings}
          />
        </section>

        <section id="methodology" className="publicSection publicMethodology" aria-labelledby="methodology-title">
          <SectionHeading
            eyebrow="HOW TO READ"
            title="数字を見る前に確認すること"
            description="ROIや的中率だけでは、再現性や安全性は判断できません。"
          />
          <div className="publicMethodGrid">
            <MethodCard title="Historical" status="探索" text="過去データで候補を探す段階。良い結果でも、そのまま今後の成績とは扱いません。" />
            <MethodCard title="Forward" status="確認" text="条件を固定した後に到着した新しいデータで、再現するかを確認します。" />
            <MethodCard title="Paper-live" status="運用検証" text="実際の時刻・取得失敗・オッズ変動を含めて判断しますが、資金は使いません。" />
            <MethodCard title="Holdout" status="最終確認" text="探索や調整に使わず封印したデータで、偶然の当たりを見抜きます。" />
          </div>
        </section>

        <section id="glossary" className="publicSection" aria-labelledby="glossary-title">
          <SectionHeading
            eyebrow="PLAIN-LANGUAGE GLOSSARY"
            title="難しい用語を、その場で理解する"
            description="用語だけを並べず、なぜ重要か・どう読むか・よくある誤解まで説明します。"
          />
          <div className="publicGlossaryGrid">
            {FEATURED_TERMS.map((term) => <GlossaryCard key={term.id} term={term} />)}
          </div>
        </section>

        <section id="safety" className="publicSection publicSafety" aria-labelledby="safety-title">
          <div>
            <p className="publicKicker">RESPONSIBLE PLAY</p>
            <h2 id="safety-title">研究結果は、利益を保証しません。</h2>
          </div>
          <div className="publicSafetyCopy">
            <p>
              競艇は損失が発生する娯楽です。公開される指標は研究状態の説明であり、購入の勧誘・自動購入・
              資金配分の指示ではありません。生活費や借入金を使わず、あらかじめ決めた範囲を超えて購入しないでください。
            </p>
            <p>
              正確な購入候補、内部threshold、推奨stake、個人の購入履歴は公開画面へ含めません。
            </p>
          </div>
        </section>

        <aside className="publicAdPlaceholder" aria-label="将来の広告掲載領域">
          <span>AD PLACEMENT RESERVED</span>
          <p>広告を導入する場合も、研究結果やBUY判断へ影響しない独立領域として扱います。</p>
        </aside>
      </main>

      <footer className="publicFooter">
        <div>
          <strong>Boat Pon Research Dashboard</strong>
          <p>公開可能な研究状態だけを表示するread-only presentation layer。</p>
        </div>
        <p>Current BUY・LINE・Mac data planeとは分離されています。</p>
      </footer>
    </div>
  );
}

function Principle({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <article className="publicPrinciple">
      <span>{number}</span>
      <div><h2>{title}</h2><p>{text}</p></div>
    </article>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="publicSectionHeading">
      <p className="publicKicker">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function MethodCard({ title, status, text }: { title: string; status: string; text: string }) {
  return (
    <article className="publicMethodCard">
      <div><h3>{title}</h3><span>{status}</span></div>
      <p>{text}</p>
    </article>
  );
}

function GlossaryCard({ term }: { term: GlossaryTerm }) {
  return (
    <article className="publicGlossaryCard">
      <h3>{term.label}</h3>
      <p>{term.plainDescription}</p>
      <dl>
        <div><dt>なぜ重要？</dt><dd>{term.whyItMatters}</dd></div>
        <div><dt>読み方</dt><dd>{term.howToRead}</dd></div>
        <div><dt>よくある誤解</dt><dd>{term.commonMistake}</dd></div>
      </dl>
    </article>
  );
}
