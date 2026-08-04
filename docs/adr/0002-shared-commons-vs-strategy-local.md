# ADR-0002: Shared Evidence Commons と Strategy Local Memory

- status: accepted
- date: 2026-08-05

## 決定
発見を 4 つの共有分類（shareClass）で管理する。「発見は共有する。採用は競争させる。思想は保護する。」

| shareClass | 共有範囲 | 例 |
|---|---|---|
| `GLOBAL_FACT` | 全方式 | settlement bug / PIT 違反 / odds timestamp 誤り / data leakage |
| `RESEARCH_METHOD` | 全方式 | bootstrap / max-hit removal / common cohort / calibration / 多重検定監査 |
| `REUSABLE_CANDIDATE` | Discovery Registry に登録（自動採用しない） | 有望 feature / interaction / 市場反応 / 会場条件 |
| `STRATEGY_LOCAL` | 方式内のみ | weight / threshold / interaction 構造 / ticket selector / SKIP 条件 / 独自モデル |

## 強制
- Commons（GLOBAL_FACT / RESEARCH_METHOD）は全方式へ共有。
- REUSABLE_CANDIDATE / STRATEGY_LOCAL は **自動採用不可**。他方式への採用は Transfer Experiment（accepted）のみ。
- CI が「Transfer 無しの adoption」を検出して fail（`detectUnauthorizedAdoptions`）。

## 影響
思想（Strategy Family）の独自性が保護され、Commons で全体の品質が底上げされる。
