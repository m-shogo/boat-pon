# Research Storage Architecture（正本 / Local-first・Cloud-ready）

更新: 2026-08-05 / authority: ADR-0004。

## 層と責務
| 層 | 責務 | 現状 |
|---|---|---|
| SQLite | Registry / state / metadata / 小規模正規化 | 使用中（sidecar は read-only 研究 source） |
| DuckDB | 大規模分析 | 将来 |
| Parquet | dataset / feature / snapshot / evaluation artifact | 将来 |
| raw archive | immutable evidence | 既存 |
| GitHub | code / schema / manifest / Registry / report summary / automation state | 使用中 |

## Provider-neutral interface（設計のみ、local adapter だけ実装）
`ArtifactStore` / `RegistryStore`（= `src/research/governance/registryStore.ts` の local 実装）/ `DatasetStore` / `EvidenceStore`。
将来 R2 / D1 / Workers / Queues / Workflows へ接続点を差し替えられる形にする。

## 禁止
- 大容量 DB / raw / model / parquet を Git に入れない（CI 検出）。
- Cloudflare アカウント作成・課金・secret・deploy をしない。D1 を研究データ本体の主 DB にしない。
