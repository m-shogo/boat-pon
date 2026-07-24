# Phase N1-A Offline All-Bet-Type Settlement Foundation

更新: 2026-07-24  
実装状態: **COMPLETE (offline foundation)**  
永続rollout: **NOT APPLIED**

## 結論

N1-Aのoffline vertical sliceを実装した。settlement、結果種別、revision、resolution、parse結果を別軸とし、F0の`capture → raw → parse → observation`へappend-only candidate、payout/refund line、evidence pin、source conflictを接続した。書込みはtest/temp DBだけであり、`data/boat.sqlite`と永続`data/research-replay.sqlite`は変更していない。

実装済み:

- schema `n1-settlement.0.1`
- migration checksum `35903ee175dbb31cbc7202aa573a2e1b4f6d58d9b6954cfac4cee0fdfa4eb94d`
- 7つのN1 tableと14個のappend-only trigger
- checksum付き`partial → applied`再開、unknown checksum default-deny
- 20-case synthetic contract fixture、F0 lineage、evidence pin、idempotency
- 7券種selection parser（NFKC、区切り正規化、順序あり/なし）
- 公式K archive parserの単勝・複勝・拡連複複数line対応
- sanitized official-Web structural fixture parser
- source conflict group/memberとappend-only resolution event schema
- parser error/unsupported schema時のcandidate生成拒否
- N1 observation typeをpost-raceとして分類するleakage sentinel
- temp migration、全archive dry-run、Legacy read-only reconciliation CLI

## 状態モデル

| 軸 | 値 |
|---|---|
| settlement status | `pending / settled / refunded / partially_refunded / cancelled / no_sale` |
| result kind | `normal / dead_heat / special_payout / source_defined / unknown` |
| revision kind | `initial / official_correction / parser_reparse / source_revision` |
| resolution status | `resolved / source_conflict / unresolved / quarantined` |
| N1 parse status | `success / warning / error / unsupported_schema` |

F0の既存`parse_runs`では`unsupported_schema`を`unknown_schema`へ写像する。parse errorとsettlement stateを同じenumへ入れず、失敗時はraw、parse run、diagnostic observationだけを残してcandidate/lineを作らない。

## Schema

- `settlement_candidates_v2`
- `race_payout_lines_v2`
- `race_refund_lines_v2`
- `settlement_evidence_pins_v2`
- `settlement_conflict_groups_v2`
- `settlement_conflict_members_v2`
- `settlement_resolution_events_v2`

全tableは`STRICT`、FKは`ON DELETE RESTRICT`、UPDATE/DELETEはtriggerで拒否する。訂正は`supersedes_candidate_id`と理由を持つ新candidateだけで表す。同一observation・券種・semantic hashはno-opとなり、異なるsourceの不一致は両candidateを残したconflict groupにする。自動解決はしない。

## Fixture / parser

20ケースを`tests/fixtures/research-replay/n1-settlement-cases.json`に固定した。通常7券種、複勝2line、拡連複3line、同着、一部/全返還、中止、発売なし、特払い、欠場、pending、conflict、訂正、parse error、未知schema、duplicate line、source一致/不一致、selection異常、PIT不適格を対象とする。

公式K fixtureでは7券種すべてを抽出し、複勝2lineと拡連複3lineを保持する。Web parserはsanitized structural fixture専用で、未知schemaや欠落を推測補完しない。live collectorへの接続はしていない。

## Archive / reconciliation

- local archive: 8,164 / 8,164 parse成功、失敗0
- race records: 1,194,007
- payout lines: 11,514,006
- schema family: modern seven-display 8,030、legacy pre-trifecta 134、unknown 0
- Legacy照合fixture: 1,440 lines
- exact: 720、N1 only: 720、payout mismatch: 0

N1 onlyは単勝144、複勝288、拡連複追加line 288である。既存5券種の主lineは720件すべて一致した。これは既存`race_payouts`を修正する根拠ではなく、N1の複数line保存が必要な証拠として扱う。

## CLI

```text
npm run research:n1:payout:fixtures
npm run research:n1:payout:migrate-temp
npm run research:n1:payout:archive-dry-run
npm run research:n1:payout:reconcile
npm run research:n1:payout:readiness
```

既定書込み先はtemp DBであり、永続sidecar apply CLIは作成していない。archive/reconciliationはローカルファイルとread-only primary connectionだけを使い、外部requestは0。

## Safety / 次の承認

Legacy consumer、Legacy ROI、BUY/WATCH/SKIP、予測、collector、shadow writer、operational GC、N2、model、productionには変更を加えていない。次の作業は別承認による永続Research Replay sidecar rolloutとfuture result collectorの設計レビューであり、本タスクでは進めない。

ローカル検証は450 tests、typecheck、production build、F0 golden、DB health、data quality、N1 review verifier、変更diffのsecret scanがPASSした。repository全履歴のgitleaksには既存9 findingが残るが、今回diffは0 finding。remote CIも[`run 30074956319`](https://github.com/m-shogo/boat-pon/actions/runs/30074956319)でPASSした。
