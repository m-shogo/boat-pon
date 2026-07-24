# Phase N1 全券種払戻基盤 schema / migration 実装前レビュー

更新: 2026-07-24
状態: **CONDITIONAL / DESIGN REVIEW COMPLETE / NOT_APPLIED**

> 2026-07-24追記: この文書は実装前レビュー時点の記録である。後続の明示承認によりN1-A offline foundationは実装完了した。現在の実装証跡は`reports/n1-all-bet-type-payout-implementation.md/json`を正本とし、永続sidecar migrationは引き続き未適用である。

## 結論

N1の保存先は **B: Research Replay sidecar (`data/research-replay.sqlite`)** を採用候補とする。既存 `data/boat.sqlite.race_payouts` は互換読取元として維持し、N1の正本には昇格させない。N1 parser、migration適用、外部取得、collector接続は別の明示承認まで開始しない。

判定がREADYではなくCONDITIONALである理由は、7券種のうち単勝・複勝が未保存で、通常・同着・返還・一部返還・不成立・特払い・訂正・source conflictを固定する20-case fixtureとparser contractがまだ実装されていないためである。

## 実測

- `race_payouts`: 5,871,974 rows / 1,190,226 races / 2000-01-01〜2026-06-01
- 保存済み: exacta 1,186,065、quinella 1,177,355、trifecta 1,170,582、trio 1,169,376、wide 1,168,596 rows
- 未保存: win、place
- 公式結果archive: 8,164 files / `k000101.lzh`〜`k260722.lzh`
- 複数的中line: exacta 5 races、quinella 5、trifecta 6、trio 6、wide 5
- canonical外の `wide=0-0`: 1 row。特払い等の可能性を推測で通常selectionへ変換しない
- `race_payouts`直接参照: 62 source/script files。N1で既存consumerを一斉切替しない
- primary key重複: 0、source: 全5,871,974 rowsが`official`、payout unit: 100円当たりの円
- 現parserは5券種のみ。race状態、raw hash、parser version、source version、同着理由、返還line、訂正履歴を保持しない
- 現保存はupsertでprovenanceを上書きするため、再parse差分・source conflictの監査正本には不適格

## 保存先比較

| 案 | 判定 | 理由 |
|---|---|---|
| A. `boat.sqlite`拡張 | **REJECTED** | Legacy formalと62 consumerのblast radiusが大きい。13GiB超のprimaryへmigrationを追加し、研究系列と運用系列を結合する |
| B. Research Replay sidecar拡張 | **PREFERRED** | F0のraw→parse→observation lineage、append-only、PIT、backup/restoreを再利用できる。公式事実層を方式間共有しつつ評価層を分離できる |
| C. N1専用sidecar | **CONDITIONAL FALLBACK** | 障害隔離は強いがraw/parse/evidenceを重複し、race identityとretentionの二重管理が発生する。容量・運用分離がBを上回ると実測された場合のみ再検討 |

## 正本lineage

```text
capture_attempt
  → raw_document (content-addressed SHA-256)
  → parse_run (parser/source-schema/canonicalization version)
  → domain_observation (official settlement observation)
  → race_settlement (race×bet type×source revision)
  → payout_line / refund_line
```

- raw bodyを先に保存し、parse errorもrawへ到達可能にする。
- settlementは結果後factであり、レース前featureに使わない。
- 同じraw hash＋parser versionの再実行は同じsemantic hashへ収束する。
- semantic差分は上書きせず、`corrected`または`source_conflict` revisionをappendする。
- `fetched_at`を確定時刻とみなさない。`source_published_at`、`source_observed_at`、`confirmed_at`を分離する。

## 状態機械

許可状態:

`pending | settled | refunded | partially_refunded | cancelled | no_sale | special_payout | parse_error | source_conflict | corrected`

原則:

- `pending`からterminal stateへ進む。terminal rowは更新せず次revisionをappendする。
- `corrected`は訂正後の新revisionで、`supersedes_settlement_id`を必須にする。
- `source_conflict`はraw evidenceを両方保持し、自動で片方を勝者にしない。
- `no_sale`、`cancelled`、`refunded`、`payout_yen=0`、selection欠測を混同しない。
- 一部返還は`partially_refunded`＋payout/refund lineの併存で表す。

## 7券種selection canonicalization

| bet type | canonical form | 通常selection数 |
|---|---|---:|
| win | `1` | 6 |
| place | `1` | 6 |
| exacta | `1-2`（順序あり） | 30 |
| quinella | `1-2`（昇順） | 15 |
| wide | `1-2`（昇順） | 15 |
| trifecta | `1-2-3`（順序あり） | 120 |
| trio | `1-2-3`（昇順） | 20 |

`0-0`、空、`特払`等をcanonical selectionへ押し込まない。raw tokenを保持し、`line_kind=special`で表す。同着は複数payout lineで保持し、同一selectionの重複だけを拒否する。複勝・wideの複数的中lineを失わない。

validatorはUnicode NFKCと区切り文字の正規化を「source tokenからcanonical候補を作る段階」に限定し、艇番1〜6、必要要素数、重複艇、順序あり/なしを券種別に検証する。0艇、7艇以上、要素重複、順序違反、空白だけ、未知区切り、欠場艇、refund-only、selection不明、未知表示は成功lineへ推測補正せず、raw tokenとreason codeを残す。source orderは`line_no`、比較用canonical orderは`selection`として分離する。

## 設計DDL（レビュー用・NOT_APPLIED）

以下は実装時のたたき台であり、実DBへ適用していない。F0 tableへのFK名は実装前にfixture DBで再検証する。

```sql
-- DESIGN ONLY / NOT_APPLIED
CREATE TABLE race_settlements_v2 (
  settlement_id TEXT PRIMARY KEY,
  canonical_race_key TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK (bet_type IN
    ('win','place','exacta','quinella','wide','trifecta','trio')),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  settlement_status TEXT NOT NULL CHECK (settlement_status IN
    ('pending','settled','refunded','partially_refunded','cancelled',
     'no_sale','special_payout','parse_error','source_conflict','corrected')),
  result_kind TEXT NOT NULL,
  observation_id TEXT NOT NULL REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  parse_run_id TEXT NOT NULL REFERENCES parse_runs(parse_run_id) ON DELETE RESTRICT,
  raw_document_id TEXT NOT NULL REFERENCES raw_documents(raw_document_id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  source_published_at TEXT,
  source_observed_at TEXT NOT NULL,
  confirmed_at TEXT,
  parser_version TEXT NOT NULL,
  source_schema_version TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  semantic_payload_hash TEXT NOT NULL CHECK (length(semantic_payload_hash)=64),
  supersedes_settlement_id TEXT REFERENCES race_settlements_v2(settlement_id) ON DELETE RESTRICT,
  correction_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (canonical_race_key, bet_type, source_type, revision_no),
  UNIQUE (raw_document_id, parse_run_id, canonical_race_key, bet_type)
) STRICT;

CREATE TABLE race_payout_lines_v2 (
  settlement_id TEXT NOT NULL REFERENCES race_settlements_v2(settlement_id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  selection TEXT,
  raw_selection TEXT NOT NULL,
  payout_yen INTEGER CHECK (payout_yen IS NULL OR payout_yen >= 0),
  popularity INTEGER CHECK (popularity IS NULL OR popularity >= 1),
  line_kind TEXT NOT NULL CHECK (line_kind IN ('normal','dead_heat','special')),
  semantic_line_hash TEXT NOT NULL CHECK (length(semantic_line_hash)=64),
  PRIMARY KEY (settlement_id, line_no),
  UNIQUE (settlement_id, semantic_line_hash)
) STRICT;

CREATE TABLE race_refund_lines_v2 (
  settlement_id TEXT NOT NULL REFERENCES race_settlements_v2(settlement_id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  refund_scope TEXT NOT NULL CHECK (refund_scope IN ('boat','selection','all')),
  boat_no INTEGER CHECK (boat_no BETWEEN 1 AND 6),
  selection TEXT,
  raw_token TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  refund_yen_per_100 INTEGER CHECK (refund_yen_per_100 IS NULL OR refund_yen_per_100 >= 0),
  semantic_line_hash TEXT NOT NULL CHECK (length(semantic_line_hash)=64),
  PRIMARY KEY (settlement_id, line_no),
  UNIQUE (settlement_id, semantic_line_hash)
) STRICT;

CREATE TABLE settlement_evidence_pins_v2 (
  settlement_id TEXT NOT NULL REFERENCES race_settlements_v2(settlement_id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('raw_document','parse_run','domain_observation')),
  evidence_id TEXT NOT NULL,
  pin_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (settlement_id, evidence_type, evidence_id)
) STRICT;
```

実装時は3 tableすべてにappend-only UPDATE/DELETE triggerを付ける。訂正は新revisionだけで表す。

## Idempotency / conflict

- capture: logical request id＋observed time、raw: SHA-256
- parse: raw id＋parser/version＋source schema＋canonicalization version
- settlement: raw/parse/race/bet-typeの一意性
- lines: settlement＋semantic line hash
- 同一key・同一hash: no-op
- 同一source revision・異なるhash: `source_conflict`をappendし停止
- 後続の公式訂正: `corrected`＋`supersedes_settlement_id`
- parser再実行だけによる差分: parser versionを増やし、旧parse/settlementを保持

## `race_payouts`との責務

- 既存tableはLegacy consumer用compatibility sourceとして凍結し、N1 rowで上書きしない。
- N1は7券種・状態・複数line・provenanceの正本候補。
- compatibility viewはN1 coverage gate後の別レビュー。初期migrationには含めない。
- `race_payouts`との照合はrace×bet type×selection×payoutで行い、差分を自動修正しない。
- ROIはsettled payoutを結果評価にのみ使い、払戻を事前oddsやfinal oddsとして使わない。

## 20-case fixture matrix

全fixtureはcapture→raw→parse→observation→settlementのlineageとevidence pinを必須にし、同じraw/parserの再実行でrow数が増えないことを共通assertionにする。

| # | fixture | 期待state | payout / refund | diagnostic / supersession |
|---:|---|---|---|---|
| 1 | 通常6艇・7券種 | `settled`×7 | canonical 7券種line | errorなし |
| 2 | 複勝2line | `settled` | normal payout×2 | 複数lineを同着扱いしない |
| 3 | 拡連複3line | `settled` | normal payout×3 | source orderとcanonical orderを別保持 |
| 4 | 同着 | `settled` | `dead_heat` payout×複数 | result_kind=`dead_heat` |
| 5 | 一部返還 | `partially_refunded` | payout＋refund | 両lineを保持 |
| 6 | 全返還 | `refunded` | all refund | payoutなしを外れ扱いしない |
| 7 | レース中止 | `cancelled` | all refundまたはraw準拠 | cancellation reason |
| 8 | 当該券種発売なし | `no_sale` | lineなし | 0倍と区別 |
| 9 | 特払い | `special_payout` | selection=NULL、raw token保持 | 通常selectionへ補正しない |
| 10 | 欠場艇 | sourceに従い`partially_refunded/refunded` | boat/selection refund | 欠場艇を0確率と同一視しない |
| 11 | 未確定 | `pending` | lineなし | 後続settledがsupersede |
| 12 | source conflict | `source_conflict` | 両sourceを別observation | 自動優先なし |
| 13 | 後日訂正 | `corrected` | 訂正版line | supersedes必須 |
| 14 | parser error | `parse_error` | lineなし | raw/pin保持、error code必須 |
| 15 | 未知表示 | `parse_error` | raw tokenのみ | 推測補正禁止 |
| 16 | duplicate source line | source stateに従う | semantic duplicateは1 line | warning必須 |
| 17 | HTML/archive一致 | `settled` | 同じsemantic payload | source別observation、conflictなし |
| 18 | HTML/archive不一致 | `source_conflict` | 両line保持 | priorityで黙って上書きしない |
| 19 | canonical selection異常 | `parse_error` | canonical lineなし | 0艇/7艇/重複/順序/全角を個別assert |
| 20 | PIT不適格source | settlement保存可、feature利用不可 | raw準拠 | timing qualityと用途拒否reason |

現時点では**設計のみでfixture未実装**。

## Source map

| source | 役割 | quality | 現状 |
|---|---|---|---|
| 公式日次K archive | historical settlement正本候補 | `official_archive` | 8,164 files、5券種parserあり、win/place未実装 |
| 公式Web結果 | future/correction観測候補 | `official_web` | N0で7券種表示確認、N1 collector未接続 |
| 既存`race_payouts` | reconciliation/Legacy compatibility | `derived_existing_row` | 5券種、provenance不足 |

source priorityは実装時にversion化するが、不一致を消すためには使わない。`source_conflict`を先に作り、確定可否をreportへ出す。

## Migration / rollbackレビュー

draft identifierは`n1-settlement.0.1-draft`、targetは`data/research-replay.sqlite`だけとする。DDLを実装用migrationへ凍結した時点で全文SHA-256 checksumを算出し、`partial → applied` ledger、checksum一致時だけのresume、unknown schema default-denyをF0-R方式で継承する。現段階ではdraftが変わり得るため正式checksumを発行しない。

1. 明示承認を記録してから開始する。
2. sidecarのWAL-safe backup、free space、schema/checksumを確認する。
3. fixture/temp DBでDDL、FK、CHECK、append-only、partial resume、rollbackを検証する。
4. expand-onlyで空tableだけ追加する。既存 `race_payouts` のcopyは同じmigrationで行わない。
5. canary rawを少数parseし、旧5券種と照合する。
6. win/placeを含む20 fixture、source conflict、訂正を通す。
7. `foreign_key_check`、`integrity_check`、row/hash/idempotencyを報告する。
8. failure時はwriterを停止し、空のN1 tableは読取対象にせずsidecarをbackupからrestoreする。primary DBのrollbackは不要。

## Request cost

- schema/fixture/temp migration検証: 0 external request
- 既存8,164 archiveのreparse: 0 external request（別タスク）
- future result-only案: N0見積り144 requests/day。ただしN1実装承認と取得承認は別
- 全市場odds取得はN2でありN1へ混ぜない

## N1開始gate

| gate | 現在 |
|---|---|
| F0-R approval gate hardening | PASS |
| F0/F0-R schema compatibility | PASS |
| 保存先・責務・lineage確定 | PASS |
| N1 target DB確定 | PASS（Research Replay sidecar） |
| 7券種canonicalization設計 | PASS |
| 状態機械・訂正・conflict設計 | PASS |
| migration/rollback設計 | PASS |
| 20-case fixture仕様確定 | PASS |
| source map確定 | PASS |
| request budget確認 | PASS |
| 20-case fixture実装・合格 | **PENDING** |
| external access不要のparser fixture確認 | **PENDING** |
| fixture DB migration test | **PENDING** |
| Legacy table / ROI非変更 | PASS |
| shadow writer / GC | PASS（OFF） |
| N1実装の別明示承認 | **PENDING** |
| production/collector接続 | OUT OF SCOPE |

総合: **N1 REVIEW: CONDITIONAL**。実装前レビューは完了したが、実装開始は許可されていない。
