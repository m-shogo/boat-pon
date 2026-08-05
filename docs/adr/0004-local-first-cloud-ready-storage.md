# ADR-0004: Local-first / Cloud-ready storage

- status: accepted
- date: 2026-08-05

## 決定
Data Plane を local-first で構築し、cloud への接続点だけ設計する（アカウント作成・課金・deploy はしない）。

| 層 | 用途 |
|---|---|
| SQLite | Registry / state / metadata / 小規模正規化データ |
| DuckDB | 大規模分析（future） |
| Parquet | dataset / feature / snapshot / evaluation artifact（future） |
| raw archive | immutable evidence |
| GitHub | code / schema / manifest / Registry / report summary / automation state |

provider-neutral interface（設計のみ・local adapter だけ実装）: `ArtifactStore` / `RegistryStore` / `DatasetStore` / `EvidenceStore`。

## 強制
- 大容量 DB / raw / model artifact を Git に入れない（CI で検出）。
- Cloudflare（R2/D1/Workers/Queues/Workflows）は将来の接続点として設計に残すのみ。D1 は将来の小規模 metadata /
  read-only dashboard 用とし、研究データ本体の主 DB にしない。secret / deployment は作らない。

## 影響
研究は今すぐ local で完結し、将来のスケールは interface 差し替えで対応できる。
