# Boat Pon Public / Owner Dashboard Roadmap

Status: DRAFT AUTHORITY
Date: 2026-08-05
Branch: `product/public-owner-dashboard-roadmap`
Owner: m-shogo

## 1. Purpose

Boat Ponの研究スケジュール・Mac runner・Current BUYロジックとは別レーンで、次のプロダクトを構築する。

1. 一般公開向けのread-only Webサイト
2. ログインしたオーナー本人だけが使う広告なしのBUY運用画面
3. LINE通知を主導線にした手動購入フロー
4. 最新N2研究状態を見やすく表示するResearch Command Center
5. 初心者にも理解できる用語Tip・用語集
6. 将来の広告収益化に対応できる広告枠・SEO・法務・プライバシー基盤

本ロードマップはChatGPT Scheduled Task `Boat Pon N2研究`とは独立して進める。研究task catalog、automation queue-state、executor、Current BUY判定を本作業の都合で変更しない。

## 2. Fixed Product Decisions

### Public mode

- ログイン不要
- 完全read-only
- 広告表示可能な構造
- 研究・検証・データ品質を中心に公開
- private BUY候補、内部設定、秘密情報、個人履歴は公開しない
- 自動購入、自動投票、投票サイト認証情報保存は行わない
- public snapshotだけを表示し、Mac DBへ直接接続しない

### Owner mode

- オーナー本人だけログイン可能
- 広告を表示しない
- 正確なBUY / WATCH候補を確認可能
- LINE通知から該当候補のprivate詳細画面へ移動可能
- 購入は手動。自動投票・自動購入は禁止
- 購入済み／見送り等の手動記録は可能
- 公開ユーザー登録、複数ユーザー、課金会員はv1対象外

### Primary operation

- 本命導線は `Mac runner → LINE通知 → Owner画面 → 手動購入`
- Webのpublic dashboardは説明・透明性・研究コンテンツ・集客が中心
- Owner画面は日々の実運用を短時間で行うための画面

### Hosting

- 研究計算は引き続きMac local-first
- 公開配信のみCloudflare Workers Static Assetsを第一候補とする
- Cloudflare D1 / KV / R2等は、private snapshotやsessionに実際に必要な最小範囲だけ採用する
- 9GB sidecarや43GB archiveをCloudflareへ移さない

## 3. Mandatory Separation

### This product lane may change

- 新しいpublic / owner Webアプリ
- 公開用・private用snapshot contracts
- snapshot exporter / validator
- read-only presentation API
- owner authentication boundary
- LINE通知payloadとprivate deep-link
- Tooltip / glossary
- SEO / privacy / responsible-play / ad placeholders
- deployment workflows

### This product lane must not change

- `automation/task-catalog.json`
- `automation/phase-mapping.json`
- `automation/boat-pon-research` branchのstate
- `src/research/governance/`の研究契約（表示adapter追加を除く）
- research executorの計算内容
- Current BUY判定条件
- prediction / decision / ticket selector
- `app_settings`
- production approval
- sidecarデータ
- holdout freeze
- 自動投票・自動購入

### Collision rules

- 専用branch・Draft PRで作業する
- mainとautomation branchへ直接大規模writeしない
- write直前にmainの最新SHAを確認する
- research scheduleが作成するintent fileへ触れない
- public snapshot生成はrunnerの研究taskと別command・別output path・別lockを使用する
- public exporter失敗は研究runnerを失敗させない
- research runner失敗時も最後の正常public snapshotを維持する
- snapshot deployは新しいvalidated snapshotがある場合だけ行う

## 4. Target Architecture

```text
Mac local data / Current BUY / Research evidence
            |
            | read-only adapters
            v
+----------------------------+
| Snapshot Export Boundary   |
| - public exporter          |
| - owner exporter           |
| - schema validation        |
| - secret / holdout guard   |
+----------------------------+
      |                 |
      | public          | private authenticated push
      v                 v
public-snapshot.json    private snapshot store
      |                 |
      v                 v
Public Web          Owner API / Owner Web
 ads-ready          ad-free / exact BUY
      |                 ^
      |                 |
      +--- SEO/content  LINE deep-link

Research Command Center reads sanitized automation/research snapshots only.
```

## 5. Application Structure

既存`src/App.tsx`を即時破壊的に置換しない。最初は新しい境界を作り、旧ローカルアプリを動かしたまま段階移行する。

推奨構成:

```text
apps/
  portal/                  # public + owner UI
  owner-worker/            # auth/private API（必要最小限）
packages/
  public-contracts/        # 公開可能schema
  owner-contracts/         # private schema
  dashboard-ui/            # shared UI
  glossary/                # terms and tips
scripts/
  export-public-snapshot.ts
  export-owner-snapshot.ts
  validate-public-snapshot.ts
  publish-owner-snapshot.ts
public-data/
  latest.json              # sanitized generated artifact only
```

実repo構造との整合を調査し、過剰なmonorepo化になる場合は既存Vite構成内の明確なdirectory boundaryへ縮小してよい。ただしpublic/private contractの分離は必須。

## 6. Screens

### Public Home

- Boat Ponの目的
- 「予想販売」ではなく、データ分析・検証透明性サイトであること
- 最新更新日時
- 研究の現在地
- 最近の検証結果
- データ品質
- Responsible Play表示
- 方法論・用語集への導線
- 将来の広告枠

### Public Dashboard

- 公開可能な日次・月次サマリー
- historical / forward / paper-liveの明確な区別
- ROI、的中率、drawdown、sample size
- 最大払戻除外指標
- データcoverage
- モデル状態
- private BUYの正確なselection・金額・内部理由は非表示

### Research Command Center

- Current Phase
- Last run / Next task
- readiness
- runner state
- task pipeline
- PASS / READY / BLOCKED / ENGINEERING_REQUIRED
- Experiment / Discovery / Rejection
- PIT / holdout / common cohort
- data health
- execution history
- evidence links
- stale snapshot警告

### Glossary

- ROI
- 的中率
- EV
- 必要オッズ
- 現在オッズ
- calibration
- drawdown
- max-hit依存
- historical
- forward
- paper-live
- PIT
- holdout
- common cohort
- Experiment
- Discovery
- Rejection
- intent
- runner
- queue-state
- sidecar
- WAL
- L0〜L4

### Owner Today

- 今日のBUY / WATCH / SKIP
- 締切までの時間
- selection
- current odds / required odds
- estimated hit rate
- EV
- stake recommendation
- data completeness
- warning / block reason
- 購入済み・見送りの手動記録
- 広告なし

### Owner Candidate Detail

- LINE通知から直接開く
- race / venue / closeAt
- BUY理由
- 除外条件
- data freshness
- odds snapshot time
- model version
- manual purchase checklist
- purchase record
- 自動投票なし

### Owner History

- 通知履歴
- 購入／見送り履歴
- 結果
- 累計stake / return / ROI
- 月別・会場別・条件別
- 返還や無効の明確な扱い

## 7. Tooltip and Glossary UX

用語定義は各componentへ直書きせず中央管理する。

各termは最低限次を持つ。

- `id`
- `label`
- `plainDescription`
- `whyItMatters`
- `howToRead`
- `commonMistake`
- `formulaOrExample`
- `detailPath`
- `updatedAt`

PC:

- hoverだけに依存しない
- focus / clickでも開ける
- keyboard対応
- `aria-describedby`

Mobile:

- tapでbottom sheet
- 閉じる操作を明確化
- 数値カードを隠さない

用語Tipは「簡単な説明」と「詳細」を分け、専門家向け情報を初心者向けUIへ詰め込みすぎない。

## 8. Authentication

v1はowner 1名のみ。

推奨:

- public rootは完全公開
- `/owner/*`と`/api/owner/*`のみ認証
- Cloudflare Access等の既存IdP連携を第一候補として評価
- allowlistはオーナー本人のidentity 1件のみ
- public pageまでAccessで閉じない
- auth headerを信頼する前にWorker側でissuer / audience / identityを検証
- session情報をpublic bundleへ埋め込まない
- owner snapshotをGit public artifactへ保存しない

Access採用が実要件や運用上不適切なら、custom authを先走って自作せずADRで代替を比較する。

## 9. LINE Primary Flow

既存LINE通知実装を調査し、重複送信防止を維持する。

```text
Current BUY decision
→ notification eligibility
→ idempotency check
→ LINE message
→ owner-only detail URL
→ login if necessary
→ candidate detail
→ manual purchase
→ manual purchase record
```

LINE messageに含める候補:

- 会場・R・締切
- selection
- current odds
- required odds
- EV
- recommended amount
- data completeness
- short reason
- owner detail URL

含めない:

- credential
- token
- DB path
- secret
- publicに漏らせない研究key
- 自動購入実行URL

同一candidate / same odds snapshot / same decision versionでは重複通知しない。意味のあるodds・decision変化時だけ再通知可能にする。

## 10. Public and Private Snapshot Contracts

### Public snapshot

許可例:

- generatedAt
- dataAsOf
- modelVersion
- aggregate metrics
- sanitized research pipeline
- public experiment summaries
- data quality
- methodology links
- public status

禁止例:

- exact private BUY selection
- stake recommendation
- internal exclusion thresholds
- app_settings
- user history
- secret
- token
- filesystem path
- raw holdout race keys
- sidecar identifiers revealing private storage
- unpublished hypothesis details

### Owner snapshot

- exact candidate rows
- exact decision details
- owner history
- notification state
- manual purchase state

Owner snapshotは認証済みprivate APIだけから取得する。

### Validation

- JSON schema
- allowlist serialization
- denylist scan
- secret scan
- path scan
- holdout-key scan
- readback
- canonical digest
- freshness
- version compatibility
- no partial publish

## 11. Automatic Update

### Public

- Mac exporterまたはvalidated Git artifactでpublic snapshot生成
- GitHub Actionsでbuild
- Cloudflare Static Assetsへdeploy
- validation失敗時はdeployしない
- last-known-goodを維持
- stale bannerを表示

### Owner

- Mac runnerのCurrent BUY更新後にprivate snapshot更新
- private upload endpointはservice authentication必須
- replay protection
- timestamp / nonce / idempotency
- owner API readback確認
- upload失敗時もCurrent BUY計算を巻き戻さない

### Frequency

- public research summary: 意味のある更新時または日次
- owner BUY: Current BUY更新時
- LINE: eligible state transition時
- Web poll: publicは低頻度、ownerは必要範囲

## 12. Advertisement Readiness

広告は初期実装で有効化せず、将来差し込める構造まで作る。

- `AdSlot` component
- owner modeでは常にdisabled
- ad blockerでlayout崩れなし
- BUYカードや操作ボタンの近くに広告を置かない
- misleading click誘導禁止
- `ads.txt`準備
- privacy policy
- cookie / consent設計
- ad provider scriptはapproval後にfeature flagで有効化
- dashboardより方法論・用語集・研究記事を主な広告配置候補とする

広告収益化前に、ギャンブル関連広告・publisher policy・公式データ利用条件・法的表示を最新情報で再確認する。

## 13. SEO and Content

- title / description
- canonical URL
- sitemap
- robots
- Open Graph
- structured dataは実態に合う範囲のみ
- glossary index
- methodology
- data sources and limitations
- update policy
- changelog
- responsible play
- privacy
- terms
- contact
- 20歳未満の舟券購入禁止表示
- 投資・収益保証のような表現をしない
- historical結果を将来収益保証として表示しない

## 14. Security and Privacy

- publicとowner APIのroute分離
- private responseに`Cache-Control: private, no-store`
- public static assetsにprivate JSONを含めない
- CSP
- HSTS
- X-Content-Type-Options
- Referrer-Policy
- frame-ancestors
- CSRF対策
- owner write APIのorigin / method / auth検証
- rate limit
- audit log
- secret rotation runbook
- private deep-linkにsecretを含めない
- public repositoryへcredentialを置かない
- LINE user/tokenをlogへ出さない

## 15. Work Phases

### Phase P0 — Grounding and ADR

- 現行React / Express / SQLite / LINE / notification / Current BUYを実測
- GETなのにwriteするendpointを棚卸し
- public/private data classification
- route matrix
- auth ADR
- hosting ADR
- advertising risk register
- collision ownership matrix

Exit:

- 現状のwrite surfaceが明確
- publicに出せる項目がschemaで固定
- research laneとの非干渉がレビュー済み

### Phase P1 — Contracts and Export Boundary

- public schema
- owner schema
- exporters
- denylist/allowlist validator
- holdout/secret/path guards
- fixture snapshots
- freshness metadata

Exit:

- DBなしでpublic UIをfixture表示可能
- public snapshotへprivate情報混入0

### Phase P2 — Research Command Center and Tips

- pipeline UI
- runner/task/readiness UI
- Experiment/Discovery/Rejection UI
- data health
- glossary registry
- accessible Tooltip / bottom sheet
- stale / NOT_AVAILABLE表示

Exit:

- 最新automation snapshot fixtureで全主要状態を説明可能
- 0を捏造しない

### Phase P3 — Public Portal

- home
- dashboard
- research
- glossary
- methodology
- legal/privacy/responsible play
- SEO
- ad placeholders
- mobile responsive

Exit:

- static build可能
- private dataなし
- Lighthouse / accessibility基準を満たす

### Phase P4 — Owner Authentication and Ad-Free Mode

- owner-only login
- `/owner/*`
- owner session API
- exact BUY view
- manual purchase record
- private cache headers
- ads disabled

Exit:

- anonymous userはowner dataへアクセス不可
- ownerだけ正確なBUY情報を閲覧可能

### Phase P5 — LINE Primary Flow

- notification adapter
- idempotency
- owner deep-link
- login return path
- notification history
- manual purchase flow

Exit:

- fixture/current paper modeでLINE→owner detail→manual recordが閉じる
- duplicate通知なし

### Phase P6 — Cloudflare Deploy and Auto Update

- Static Assets
- Worker routing
- public deploy
- private API
- environment config
- GitHub Actions dry-run
- last-known-good
- rollback

Exit:

- public URL
- owner route protected
- validated snapshotのみ反映
- Mac DBへのpublic network pathなし

### Phase P7 — Hardening

- auth bypass tests
- snapshot leakage tests
- CSP
- rate limit
- stale data UX
- crash/partial upload
- deploy rollback
- monitoring
- accessibility
- mobile QA

### Phase P8 — Ad Activation Preparation

- policy review
- content quality review
- ads.txt
- consent/privacy
- feature flag
- owner mode ad exclusion test

広告アカウント申請・広告コード有効化はユーザーの明示操作後のみ。

## 16. Test Matrix

最低限:

1. public snapshotにexact BUYなし
2. public snapshotにstakeなし
3. public snapshotにapp_settingsなし
4. raw holdout keyなし
5. secretなし
6. local absolute pathなし
7. owner snapshotがpublic buildへ混入しない
8. anonymous owner route拒否
9. owner allowlist外拒否
10. owner mode広告なし
11. public modeAdSlot feature flag
12. stale snapshot表示
13. invalid schema deploy拒否
14. partial upload無視
15. last-known-good維持
16. duplicate LINE通知なし
17. changed decision再通知契約
18. manual purchase record idempotent
19. GET public endpoint write 0
20. Current BUY logic diff 0
21. app_settings diff 0
22. research task catalog diff 0
23. automation branch direct write 0
24. sidecar write 0
25. mobile tooltip操作
26. keyboard tooltip操作
27. screen reader labels
28. public cache/private no-store
29. auth callback return path
30. owner detail direct link login復帰
31. deploy rollback
32. secret scan
33. build/typecheck/tests/CI green

## 17. Definition of Done

- Public portalが公開可能
- Owner本人だけログイン可能
- Owner mode広告なし
- public modeは広告追加可能な構造
- LINEがBUY運用の主導線
- manual purchaseのみ
- public/private snapshot完全分離
- Mac DBをインターネット公開しない
- Research Command Centerが最新状態を説明
- Tooltipと用語集が初心者にも理解可能
- public endpoint write 0
- Current BUY・app_settings・research automation非変更
- last-known-good / rollbackあり
- security/privacy/responsible-playページあり
- CI green

## 18. Explicit Non-Goals

- 自動投票
- 自動購入
- 投票サイトcredential保存
- public user registration
- subscription billing
- prediction販売
- 複数ユーザー管理
- 研究DBのcloud移行
- 9GB sidecarの公開
- Current BUY条件の変更
- N2 executor開発
- ChatGPT研究スケジュールの変更

## 19. First Implementation Slice

最初のPRは大きくしすぎず、以下だけを閉じる。

1. P0 Grounding
2. public/private data classification
3. ADR
4. public snapshot schema v1
5. fixture
6. validator
7. Research Command Centerのread-only shell
8. glossary registryとTooltip基盤
9. Current BUY / automation / app_settings非変更テスト

Owner auth、LINE、Cloudflare deploy、広告は後続PRへ分離する。

## 20. Reporting Contract

各PRで報告する。

- start main SHA
- branch
- scope
- changed files
- public/private data changes
- Current BUY diff
- app_settings diff
- automation/task catalog diff
- sidecar writes
- tests
- typecheck
- build
- CI
- screenshots
- security findings
- unresolved blockers
- next slice

未実行・未検証をPASSと報告しない。
