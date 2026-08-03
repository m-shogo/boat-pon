# N2 settlement reparse apply runbook（承認前・実sidecar未適用）

更新: 2026-08-03
状態: **NOT APPROVED / real-sidecar apply NOT EXECUTED / production apply BLOCKED**

本書は、v1 parser defect（`V1_SPECIAL_PAYOUT_FALSE_REFUND`）由来の誤 refund candidate を、永続 sidecar
`data/research-replay.sqlite` へ append-only supersession で訂正するための**承認可能パッケージ**である。
temp copy 上で完全にリハーサル済みだが、実 sidecar への適用承認は与えられていない。承認 artifact は
`reports/n2/settlement-reparse-approval-manifest.json`（manifest v2, approvalTargetDigest 付き）。

### 2026-08-03 更新（承認 gate 実装・保留2件確定・manifest v2）

- production apply gate `apply:n2:settlement-reparse` を実装。既存 append-only approval lifecycle
  （`resolveApproval`）を再利用し、`resolveReparseApplyGate` が approval target digest / source snapshot
  SHA・size / schema / mode=production / code SHA を束ねて解決する。有効な production approval が無ければ BLOCKED。
- **実 sidecar に対し gate を実行し `BLOCKED`（exit 3）を確認**（`reports/n2/settlement-reparse-apply.json`）:
  blocks=`[MANIFEST_MARKED_NOT_APPROVED, APPROVAL_SCOPE_MISMATCH]`。sidecar への write は 0（immutable open）。
- unexpected_addition 2 件を read-only 調査で確定: `2014-03-28:08:R1/win` と `2014-03-28:17:R2/win`、いずれも
  v2=win 返還・v1 candidate 無し → **`CONFIRMED_V1_WIN_REFUND_OMISSION`**（本 special-payout reparse の scope 外の
  別 v1 defect）。auto-apply せず hold。正本 `reports/n2/unexpected-additions-audit.json`。
- approval manifest を v2 へ再固定。旧 approvalTargetDigest `647993a1…` を superseded として記録し、
  新 digest `7e38b564d6fa435ef08edfa0a4d67a319b107f9570ad94d289e821394faac12c`（source SHA・size・schema・git SHA・
  archive inventory digest `ee402370…`・parser/canonicalization/contract versions・件数・canary/full/rollback digest・
  expected before/after・rollback strategy・scope・mode・validity を束ねる）。
- **有効な production approval は存在しない**（sidecar の approval grant は F0-R と N1-B のみ）。production apply は BLOCKED。

## 1. 背景と defect

N1-C backfill は `n1-settlement-parser-v1` で 8,170 archive を投入した（sidecar の全 `parse_runs.parser_version` は v1）。
v1 は archive 中の「特払い」を race-wide 返還として扱い、同一 race の後続正常払戻まで `returned=true` に汚染した。
結果、canonical active candidate に **偽 refund** が大量に混入している。v2（`n1-settlement-parser-v2`）は特払いを
券種別 `special_payout` line として分離済み。

## 2. 実測影響（temp copy, read-only 監査 + reparse）

- 独立 reconciliation（`reports/n2/archive-canonical-reconcile.json`）: active refunded ≈319,301 のうち
  **317,747 が偽返還（refunded→settled）**、真の返還は約 1,554。
- full reparse（`reports/n2/settlement-reparse-full.json`, digest `247310fb…`）で candidate-level に確定:
  - false_refund_correction: **317,747**（reconciler と完全一致）
  - special_payout_addition: **65,156**（v1 が抑止していた特払い candidate）
  - result_kind_correction: 0 / ambiguous_non_defect: 0 / **unexpected_addition: 2（適用せず flag のみ）**
  - active before → after: settled 7,833,297 → 8,216,200 / refunded **319,301 → 1,554** / partially_refunded 1 → 1
  - logical active 8,152,599 → 8,217,755（+65,156 additions）、physical rows 8,156,795 → 8,539,698（append-only）
  - after は delta 計算と full-scan 実測が一致（afterConsistent=true）

## 3. 訂正方式（append-only supersession）

- 既存 row を UPDATE/DELETE しない。
- raw document ごとに v2 `parse_run`（`parser_name=n2-settlement-reparse`, `correction_kind=parser_reparse`,
  `supersedes_id`=当該 v1 parse_run）を追記。
- false refund は corrected candidate（`revision_kind=parser_reparse`, `supersedes_candidate_id`=v1 candidate,
  `correction_reason=V1_SPECIAL_PAYOUT_FALSE_REFUND`）を append し、v1 candidate を supersede。
- 抑止されていた特払いは `revision_kind=initial` candidate として append（predecessor 無し、同 reparse parse_run 所属）。
- 訂正対象は defect と確定できる形（refunded/partially_refunded → settled、special payout 欠落追加）に**限定**。
  それ以外の差分（ambiguous_non_defect / unexpected_addition）は訂正せず記録のみ（fail-closed）。
- backfill cutoff 後の未 ingest race（archive にあるが sidecar raw に無い）は hash 不一致で **not_ingested として除外**
  （8,174 files 中 7 files、full race の欠落であり defect 訂正の対象外）。

## 4. append-only / PIT 保証

- append-only trigger が UPDATE/DELETE を拒否（temp copy で実証: updateBlocked/deleteBlocked=true）。
- active resolver は「非 source_duplicate かつ非 superseded」で最新 successor を一意に返す（ambiguous active keys=0）。
- rollback は resolver 切替（reparse parse_run 由来を無視）で v1 original を復元でき、既存 row を削除しない。
- `observed`（当時の v1 parse 結果）と `corrected_truth`（v2 訂正）は parse_run/observation 系列で区別される。
  過去 model 入力へ corrected truth を自動 leak させない。corrected label を学習/評価に使う場合は明示的に
  reparse parse_run を選択する。

## 5. リハーサル結果（temp copy）

| 項目 | 結果 |
|---|---|
| canary（決定的 cohort 46 files） | REPARSED、second-run appended 0、append-only enforced |
| full temp-copy reparse | REPARSED_WITH_FLAGS（unexpected_addition 2 のみ）、afterConsistent=true |
| full integrity | integrity_check=ok / FK 0 / orphan 0 / ambiguous active 0 |
| second run（idempotency） | appended 0 / supersessions 0 |
| rollback（operational disable） | rolled-back active = v1 original（refunded 319,301, settled 7,833,297） |
| append-only reversal | 監査追記、double-rollback idempotent、physical rows 不変、audit UPDATE/DELETE blocked |
| backup / restore | VACUUM INTO quick_check=ok、restore hash 一致、resolver 結果一致 |
| source 非伝播 | `data/research-replay.sqlite` SHA-256 不変（write 0） |

## 6. 容量・所要時間

- source 9,019,846,656 bytes（8.4GiB）。temp copy 必要。full reparse 後 physical +382,903 rows。
- full reparse 実測所要 ≈ 47.3 分（copy + 1 sequential scan + 8,167 files reparse + second-run + full integrity）。
- disk: temp copy + backup + restore ≈ 27GB を要する。実行前に free 空間確認。

## 7. 残存リスク

- **unexpected_addition 2 件（確定）**: `2014-03-28:08:R1/win`・`2014-03-28:17:R2/win`。v2=win 返還、v1 candidate 無し。
  分類 `CONFIRMED_V1_WIN_REFUND_OMISSION`（v1 が win 返還 candidate を欠落させた別 defect）。本 special-payout reparse の
  scope 外につき適用しない。将来、別 defect code・別承認で「v1 win 返還欠落」を訂正する場合は独立パッケージにする。
- **not_ingested 7 files / 未マッチ raw 3 件**: archive バイト列が sidecar raw と不一致（backfill cutoff 後日次・source-duplicate 由来）。
  reparse scope 外。必要なら別途 incremental backfill で扱う。
- 実 sidecar 適用は WAL/並行 writer が無い quiescent snapshot でのみ行うこと。

## 8. 実 sidecar 適用手順（承認後のみ・現時点で実行禁止）

> 本 CLI は `--mode=production` を常に BLOCKED にしている。実適用には (a) `approvalTargetDigest` と snapshot identity に
> 束ねた明示的 append-only approval grant、(b) 事前 backup、(c) canary、(d) rollback rehearsal がすべて満たされること。

承認が下りた場合の想定手順（dry-run として文書化。実行しないこと）:

```bash
# 0. quiescent 確認（shadow writer/collector OFF、-wal 無し、SHA-256 記録）
shasum -a 256 data/research-replay.sqlite

# 1. backup（VACUUM INTO + quick_check + hash）
#    ※実適用 driver は本パッケージに含めない。承認時に production apply gate を別実装する。

# 2. temp copy で再現（本 CLI、simulated のまま）: digest 247310fb… の再現を確認
pnpm reparse:n2:settlement -- \
  --source-sidecar=data/research-replay.sqlite \
  --target-sidecar=data/tmp/reparse-verify.sqlite --make-copy --overwrite-temp \
  --verify --second-run-check \
  --as-of=2026-08-01T00:00:00.000Z --mode=simulated

# 3. rollback / backup-restore rehearsal 再確認
pnpm reparse:n2:rollback-rehearsal -- --target-sidecar=data/tmp/reparse-verify.sqlite --as-of=2026-08-01T00:00:00.000Z

# 4. （承認後）production apply gate を通した上で実 sidecar へ append-only 適用。
pnpm apply:n2:settlement-reparse -- \
  --sidecar=data/research-replay.sqlite \
  --archive-root=data/raw/official/results \
  --manifest=reports/n2/settlement-reparse-approval-manifest.json \
  --approval-grant=<approval-grant-id> \
  --as-of=<UTC> --mode=production
#    gate は approvalTargetDigest / snapshot SHA-256・size / schema / mode / code SHA / WAL / disk を検査し、
#    有効な production approval（scope=N2_SETTLEMENT_REPARSE_APPLY, mode=production, 非revoked/superseded）が
#    無ければ exit 3 で BLOCKED、write 0。承認済みのみ TOCTOU 再確認後に append-only 適用。
```

承認者が承認する場合の grant 記録（Claude は作成しない）:

```text
rollout_approval_grants_v2 へ append:
  approval_scope          = N2_SETTLEMENT_REPARSE_APPLY
  approval_mode           = production
  target_stage            = N2-REPARSE-APPLY
  target_schema_version   = n1-settlement.0.3@<sourceSha256>
  target_contract_version = n2-settlement-reparse-apply-v1:<approvalTargetDigest>
  approved_at             = <apply 実行より前の UTC>
```

## 9. 適用後の検証（承認・適用後に実施）

- active resolver: refunded ≈1,554 / settled ≈8,216,200、ambiguous active keys 0。
- integrity_check=ok / FK 0 / orphan 0。
- rollback で v1 original（refunded 319,301）へ戻せること。
- 既存 v1 row が物理的に残存（append-only）。

## 10. 中止条件

- source SHA-256 が記録値（`d9b5ddd2…`）と不一致 → BLOCKED。
- 実行中に snapshot が変化（size/hash/-wal 出現）→ BLOCKED。
- approvalTargetDigest / snapshot identity 不一致 → BLOCKED。
- unexpected_addition や ambiguous が想定超 → BLOCKED、手動レビュー。

## 承認対象

- approvalTargetDigest（manifest v2）: `7e38b564d6fa435ef08edfa0a4d67a319b107f9570ad94d289e821394faac12c`（旧 `647993a1…` は superseded）。
- source snapshot SHA-256: `d9b5ddd264ea138f319b04a8fb9398f1048bb2ad3001055ffe319616d6b6cb92` / size 9,019,846,656 / schema `n1-settlement.0.3`。
- **本パッケージは未承認である**。real-sidecar apply=NOT EXECUTED / production approval=NOT CREATED / production apply=BLOCKED。
- 可視化: `reports/n2/settlement-reparse-dashboard.html`（Before/After・実レース例・年別/券種別・進捗）、`reports/n2/settlement-reparse-before-after.md`。
