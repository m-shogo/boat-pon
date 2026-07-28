# N1 Settlement Evidence GC Safety Contract（Option B / implicit pin）

更新: 2026-07-27
状態: **ACTIVE / GC は未接続・OFF**

N1-C backfill は Option B（`emitEvidencePins=false`）で candidate を投入する。explicit な `settlement_evidence_pins_v2` 行を candidate ごとに保存しない代わりに、candidate の外部キーを **暗黙 GC pin** として扱う。本書はその安全契約を固定する。

## 暗黙 pin の根拠

`settlement_candidates_v2` は次の3列を `ON DELETE RESTRICT` FK で保持する。

- `raw_document_id → raw_documents`
- `parse_run_id → parse_runs`
- `domain_observation` … `observation_id → domain_observations`

candidate が1件でも存在する限り、参照先 raw/parse/observation は削除できない（RESTRICT）。さらに backfill は raw ごとに `parse_runs` と `domain_observations` を必ず作るため、operational GC（`RolloutController.collectUnreferencedRaw`）は当該 raw を「未参照」と判定しない。GC は次のいずれかが存在する raw を削除対象から除外する。

- `evidence_pins`（F0 manifest pin）
- `capture_raw_links`
- `parse_runs`
- `domain_observations`
- `evidence_tombstones`

candidate 由来の raw は常に `parse_runs` と `domain_observations` を伴うため、explicit pin が0でも GC 対象にならない。GC 実装は explicit pin 「だけ」に依存していない。

## 安全条件（audit で検証済み）

`reports/n1c-backfill/phase4-optionb-audit.json` で次を実測PASS:

1. Option B の explicit pin は **0**、Option A（既定）は 3/candidate。
2. candidate 参照中の raw は GC で削除されない（explicit pin 0 でも parse_run/observation 経由で保護）。
3. `ON DELETE RESTRICT` により candidate 参照中の `raw_documents` 行は直接 DELETE できない。
4. append-only trigger により candidate/payout/refund/pin は UPDATE/DELETE 不可。
5. Option A と Option B は **意味論同一**（candidate/payout/refund 件数一致）、差は容量表現（pin行）だけ。
6. 永続 sidecar の operational GC / shadow writer は **OFF**、kill-switch は運用時のみ。

## 監査証跡は消えない

explicit pin は raw/parse/observation への冗長な参照であり、削減しても監査証跡そのもの（capture→raw→parse→observation→candidate→payout/refund の lineage）は candidate FK と各 evidence table にすべて残る。`settlement_evidence_pins_v2` table は将来の cohort/evaluation pin 用に残す（backfill では自動投入しない）。

## GC 有効化ゲート（将来）

operational GC を有効化するには専用の readiness gate が必要であり、本 backfill では有効化しない。有効化前に最低限:

- candidate FK を GC の参照集合として明示的に含める回帰テスト
- superseded candidate の参照保持規則の再確認
- tombstone → hash 再検証 → 物理削除 → `gc_deleted` の順序監査
- restore-copy 上での実削除 canary

を通し、別の明示承認を得ること。本契約に反する GC 有効化は禁止する。
