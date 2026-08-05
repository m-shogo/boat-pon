# Research Storage Architecture（正本 / Local-first・Cloud-ready）

更新: 2026-08-05 / authority: ADR-0004。

知識の種類・正本・昇格境界・未実装のclosed-loop要素は
`docs/architecture/research-knowledge-retention-contract.md` を参照する。

## 層と責務
| 層 | 責務 | 現状 |
|---|---|---|
| SQLite | Registry / state / metadata / 小規模正規化 / decision audit | 使用中（sidecar は read-only 研究 source） |
| DuckDB | 大規模分析・evaluation query | 将来 |
| Parquet | dataset / feature / cohort / evaluation artifact | 将来 |
| raw archive | immutable evidence | 既存 |
| GitHub | code / schema / manifest / append-only Registry / report summary / automation state / governance contract | 使用中 |
| Cloudflare Public | sanitized public projection only | 将来。研究・BUYの正本ではない |

## 現在の知識保持状態

- raw evidence、PIT/lineage、Current BUYのdecision audit、Gitのappend-only research Registryは使用中。
- Experiment / Discovery / Rejection / Transfer / Promotionは1 record = 1 file、digest付き、append-onlyで保持する。
- Scheduled Taskの結果はchat本文だけで完了扱いにせず、artifact / registry / evidence / blocked reportのいずれかへ残す。
- Runtime Decision Ledger / Outcome Learning Ledger / Forward Evaluation Vaultは設計済みだが、完全なformal closed loopとしては未実装。
- Current BUYの自動再学習・自動条件変更・自動production昇格は行わない。

## Provider-neutral interface（設計のみ、local adapter だけ実装）
`ArtifactStore` / `RegistryStore`（= `src/research/governance/registryStore.ts` の local 実装）/ `DatasetStore` / `EvidenceStore`。
将来 R2 / D1 / Workers / Queues / Workflows へ接続点を差し替えられる形にする。

Cloud providerへ移しても正本の意味を変えない。保存先の変更と、研究結果の採用・BUY変更は別の承認対象とする。

## 禁止
- 大容量 DB / raw / model / parquet を Git に入れない（CI 検出）。
- D1 を研究データ本体の主 DB にしない。
- Public Web / analytics / SEO / advertising dataをCurrent BUYや研究結果の正本にしない。
- chat memoryだけを研究知識の唯一の保存先にしない。
- scheduled researchからCurrent BUY、`app_settings`、productionへ直接接続しない。
