# N2 settlement reparse — approval operator runbook（人間承認手順）

更新: 2026-08-03
状態: **NOT APPROVED / real-sidecar apply NOT EXECUTED / production apply BLOCKED**

本書は、v1 特払いbug由来の誤 refund candidate を実 sidecar `data/research-replay.sqlite` へ
append-only supersession で訂正する production apply を、**人間の operator** が承認・実行するための手順である。
**Claude はこの grant を作成・記録・実行しない**（自己承認禁止）。

## 承認対象（固定値・v3）

| 項目 | 値 |
|---|---|
| approval scope | `N2_SETTLEMENT_REPARSE_APPLY` |
| mode | `production` |
| target stage | `N2-REPARSE-APPLY` |
| settlement schema | `n1-settlement.0.3` |
| **settlement snapshot identity** | `a7d68acb5be241e280508b5ba5a54c14714d27fbba39cb11f2c6d50de843f9cf` |
| **approval target digest（v3）** | `6e2eb2abd1453c551d08af9d921fb0f1cb77369172d3c0b1c748948d4aea3fe8` |
| target_schema_version | `n1-settlement.0.3@a7d68acb…` |
| target_contract_version | `n2-settlement-reparse-apply-v1:6e2eb2ab…` |
| apply code Git SHA | `fa3223b80fca14cf31a0ec6e05f313bc2cb36b63` |
| whole-file SHA-256（**advisory**） | `d9b5ddd2…`（grant 記録で変化するため束縛に使わない） |
| false-refund corrections | 317,747 |
| special-payout additions | 65,156 |
| genuine refunds remaining | 1,554 |
| held-out（manual review, scope外） | 2（`CONFIRMED_V1_WIN_REFUND_OMISSION`: 2014-03-28 常滑R1/win, 宮島R2/win） |

> **重要（snapshot 束縛の設計）**: production apply gate は sidecar の *settlement-content identity*
> （settlement テーブルの DDL＋status×revision×superseded 分布＋line/candidate/source_dup 件数）を snapshot 束縛に使う。
> これは approval grant / 監査行の append で **不変**。whole-file SHA-256/size は grant を記録すると変化する（実証済み）ため、
> gate では advisory record のみで BLOCK 条件に使わない。過去 v1/v2 manifest（`647993a1…`/`7e38b564…`）は whole-file SHA を
> 束縛していて in-DB approval では apply 不能だったため supersede した。

固定値の再確認は read-only で:

```bash
# manifest 整合・digest 再計算・settlement identity（scan あり, 数分）
GIT_SHA=fa3223b80fca14cf31a0ec6e05f313bc2cb36b63 pnpm apply:n2:settlement-reparse -- \
  --sidecar=data/research-replay.sqlite \
  --manifest=reports/n2/settlement-reparse-approval-manifest.json \
  --as-of=<UTC> --mode=production
# 承認前は必ず BLOCKED（APPROVAL_SCOPE_MISMATCH 等, exit 3, write 0）
```

## Before / After（適用予定・temp-copy 実測）

| 指標 | Before | After |
|---|---:|---:|
| active settled | 7,833,297 | 8,216,200 |
| active refunded | 319,301 | 1,554 |
| active partially_refunded | 1 | 1 |
| active logical candidates | 8,152,599 | 8,217,755 |
| false-refund supersessions | — | 317,747 |
| special-payout additions | — | 65,156 |

held-out 2 件（win 返還欠落）は本 reparse の scope 外であり、**適用しない**。別 defect・別承認で扱う。

## Step 1 — approval grant 記録（operator が実行。Claude は実行しない）

承認する場合のみ、operator が次を実行する。placeholder（source/reference/approved-at）を埋めること。

```bash
pnpm research:approval:record -- \
  --event=grant \
  --sidecar=data/research-replay.sqlite \
  --approval-id=n2-settlement-reparse-apply-d9b5ddd2-6e2eb2ab \
  --scope=N2_SETTLEMENT_REPARSE_APPLY \
  --approval-mode=production \
  --target-stage=N2-REPARSE-APPLY \
  --target-schema='n1-settlement.0.3@a7d68acb5be241e280508b5ba5a54c14714d27fbba39cb11f2c6d50de843f9cf' \
  --target-contract='n2-settlement-reparse-apply-v1:6e2eb2abd1453c551d08af9d921fb0f1cb77369172d3c0b1c748948d4aea3fe8' \
  --source='<APPROVER work-order id / signed reference>' \
  --reference='<APPROVER reference URL or doc>' \
  --approved-at='<UTC ISO8601, apply 実行より前>'
```

- append-only（UPDATE/DELETE しない）。content_hash は CLI が grantHash で自動計算する。
- この操作は sidecar の approval table にのみ append する（settlement data は不変＝settlement identity 不変）。
- grant 記録後、whole-file SHA-256 は変化するが、gate は settlement identity で束縛するため問題ない。

### Step 1 前の最終確認

- [ ] 上記固定値（digest/identity/schema/scope/contract）が manifest と一致（read-only gate が settlement identity 一致を示す）
- [ ] `-wal`/`-shm` 不在（quiescent）
- [ ] 並行 writer（collector 等）が settlement table を書いていない
- [ ] backup 先の空き容量十分
- [ ] approver identity / approved-at を実値で用意（捏造しない）

## Step 2 — grant 記録後の read-only 確認

```bash
sqlite3 'file:data/research-replay.sqlite?immutable=1' \
  "SELECT approval_id, approval_scope, approval_mode, target_stage, target_schema_version, target_contract_version, approved_at FROM rollout_approval_grants_v2 WHERE approval_scope='N2_SETTLEMENT_REPARSE_APPLY';"
```

apply-intent manifest（`reports/n2/settlement-reparse-apply-manifest.json`, digest 不変）で gate を再確認:

```bash
GIT_SHA=fa3223b80fca14cf31a0ec6e05f313bc2cb36b63 pnpm apply:n2:settlement-reparse -- \
  --sidecar=data/research-replay.sqlite \
  --manifest=reports/n2/settlement-reparse-apply-manifest.json \
  --approval-grant=n2-settlement-reparse-apply-d9b5ddd2-6e2eb2ab \
  --as-of=<UTC> --mode=production --report-name=settlement-reparse-apply-preflight
# grant が有効なら status=PASS になる（この preflight は gate 解決のみ read-only）。
```

## Step 3 — production apply（gate PASS 後・operator 実行）

gate PASS を確認したら、同一 apply CLI が backup→apply→verify を実行する（temp-copy と同一 engine コードパス）。
中止条件（下記）に該当したら full apply へ進まず rollback runbook（`docs/n2-settlement-reparse-apply-runbook.md`）に従う。

## 承認の取消し / supersede（append-only）

```bash
# 取消し（revoke）
pnpm research:approval:record -- --event=revoke --sidecar=data/research-replay.sqlite \
  --event-id=<uuid> --subject-approval-id=n2-settlement-reparse-apply-d9b5ddd2-6e2eb2ab \
  --reason='<理由>' --source='<operator>' --reference='<ref>' --occurred-at='<UTC>'
# 差し替え（supersede）
pnpm research:approval:record -- --event=supersede --sidecar=data/research-replay.sqlite \
  --event-id=<uuid> --subject-approval-id=n2-settlement-reparse-apply-d9b5ddd2-6e2eb2ab \
  --replacement-approval-id=<new-grant-id> --reason='<理由>' --source='<operator>' --reference='<ref>' --occurred-at='<UTC>'
```

revoke/supersede 後は gate が `APPROVAL_REVOKED`/`APPROVAL_SUPERSEDED` で BLOCKED になる。既存 grant 行は削除・改変しない。

## 中止条件（gate が BLOCK / operator が中止）

settlement snapshot identity mismatch / schema mismatch / active WAL / backup 失敗 / canary mismatch /
unexpected addition 増加 / held-out 範囲変更 / duplicate / supersession cycle / dangling / orphan / FK failure /
integrity failure / second-run が no-op でない / approval missing・revoked・superseded・simulated / code SHA mismatch。

## 明記

- **real-sidecar apply は未実行**。本手順は承認・実行の準備であり、grant を記録するまで何も適用されない。
- **Claude は grant を作成・記録・実行していない**。approver identity / approved-at は人間が入力する。
- held-out 2 件は本 reparse の scope 外で適用しない。
- 正本: approval grant JSON `reports/n2/settlement-reparse-approval-grant.json`、apply-intent manifest
  `reports/n2/settlement-reparse-apply-manifest.json`、manifest `reports/n2/settlement-reparse-approval-manifest.json`、
  schema `config/n2-settlement-reparse-approval-grant.schema.json`、可視化 `reports/n2/settlement-reparse-dashboard.html`。
