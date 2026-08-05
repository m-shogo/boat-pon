# research/registries — 研究 Registry（individual-file / append-only）

研究ガバナンスの正本レジストリ。**1 record = 1 file**、**append-only**（既存 record を上書き・改変しない）。
巨大な単一 JSON に集約しない（Git diff と並行研究のため）。

| ディレクトリ | 内容 | id | schema |
|---|---|---|---|
| `experiments/` | Experiment（中立 EXP-*） | `EXP-*` | `config/research-governance/experiment-registry.schema.json` |
| `discoveries/` | Discovery（共有分類付き） | `DISC-*` | `discovery-registry.schema.json` |
| `strategy-families/` | Strategy Family（思想） | `STRAT-*` | `strategy-family-registry.schema.json` |
| `strategy-versions/` | Strategy Version（`STRAT__version`） | `version` | `strategy-version-registry.schema.json` |
| `transfer-experiments/` | Discovery→他方式 の唯一の採用経路 | `XFER-*` | `transfer-experiment-registry.schema.json` |
| `promotions/` | 昇格（人間承認必須・production 非接続） | `PROMO-*` | `promotion-registry.schema.json` |
| `rejections/` | 棄却・negative result | `REJ-*` | `rejection-ledger.schema.json` |

- 追加は `appendRecord`（`src/research/governance/registryStore.ts`）経由。バリデーション失敗 / 重複 id は拒否。
- CI が `validateAllRegistries`（schema + filename + digest 改変検出）と `checkLineage`（dangling 参照検出）を実行する。
- 型・validator は `src/research/governance/contracts.ts`。例は `research/fixtures/example-lineage/`。

## 不変条件（CI enforced）

- Discovery は **Transfer Experiment（accepted）** 経由でしか他 Strategy に adopt されない（自動採用不可）。
- clean-room Strategy Family は `GLOBAL_FACT` / `RESEARCH_METHOD` 以外を adopt しない。
- Promotion の `active_research`/`challenger` は **人間承認 + transfer 証拠**が必須。`productionConnection` は常に `false`。
- Current BUY（`legacy_t5_formal`）と Research（`market_intelligence`）は `decisionSystem` で構造分離。
