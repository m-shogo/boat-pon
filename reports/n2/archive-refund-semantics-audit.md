# Archive refund semantics audit

更新: 2026-08-01  
状態: **SCANNER_IMPLEMENTED / RAW_ARCHIVE_IMPACT_PENDING**

## 結論

旧 `n1-settlement-parser-v1` には、archive中の「特払い」をrace-wide返還として扱う分類bugがあった。

`parseOfficialResultDetail` は従来、同一race内で「不成立」または「特払い」を見つけると `returned=true` をrace終了まで保持した。そのため「特払い」の行自体だけでなく、後続してparseされる正常な他券種払戻行まで `RacePayout.returned=true` になった。さらに `classifyRaceLines` は `returned=true` を `ARCHIVE_RETURNED / refundYenPer100=100` へ変換するため、70円の特払いと100円返還が混同された。

これは次の契約と矛盾する。

- N1 fixture: 特払いは `lineKind=special_payout`、`payoutYen=70`
- 返還: `race_refund_lines_v2`、通常100円
- 特払い: 的中selectionへの通常配当がない券種で、その券種の購入票へ行う券種別払戻。race全体の不成立ではない

## 修正

- race-wide `returned` sentinelは「不成立」だけで立てる
- 「単勝 / 複勝 / 2連単 / 2連複 / 拡連複 / 3連単 / 3連複 + 特払(い) + 金額」を券種別 `special_payout` lineとしてparse
- sourceに金額がない場合は70円を推測補完せず、既存fail-closed方針を維持
- parser versionを `n1-settlement-parser-v2` へ更新
- 回帰testで、特払い後のexacta/trifectaが返還へ汚染されないこと、不成立は引き続きrace-wide返還になることを固定

実装commit:

- `5a4efc980607905595da09bf65324cbd10f49c2a` — parser分類修正
- `c9e28b5b9d72ee82145c553c8d407f99441e1fd1` — parser version v2
- `a0ff30aab11649abcbf90d22fdc476651c872084` — regression tests

## 影響範囲

### 確定

- v1コードでは「特払い」以降の同race正常払戻行が返還化し得た
- N2 profileの `excluded_refunded=319,301` と早期eraのeligible低下は、v1分類を入力に含む
- append-only sidecarの既存v1 observation/candidateは、このコード修正だけでは変化しない

### 未確定

- 319,301件のうち何件が誤分類か
- year × bet_type別の誤分類数
- 2004–2019のeligible driftをこのbugが何%説明するか
- 特払いと実返還が同時に存在するraceの正しいselection-level financial label

したがって、既存profileの約87%→99.9%を制度差・実返還率driftとして学習設計に使わない。N2 label truthはfull raw reparse差分が終わるまで未確定。

## v1/v2差分scanner

実装済み:

- `parseOfficialResultDetailLegacyV1ForAudit`: production既定をv2のまま維持し、旧bugを監査専用に再現
- `compareRefundSemantics`: unchanged候補を全件保持せず、変更行と集計値だけを返す
- `scripts/audit-archive-refund-semantics.ts`: immutable K archiveをv1/v2でread-only二重parse
- `pnpm audit:n2:archive-refund-semantics`: full scan
- `pnpm audit:n2:archive-refund-semantics -- --limit=20`: smoke scan
- 出力: `reports/n2/archive-refund-semantics-diff.json/.md`
- 集計軸: `year × bet_type × event_kind`
- event: `special_payout_added` / `false_refund_reclassified` / `other_change`
- N2 profileの319,301件はcanonical candidate-levelなので、raw scanner値と即時同一視せずsource-duplicate resolution後にreconciliationする

scanner実装commit:

- `b7c03a3f267ee2479063eb63f5f9581db294ec55` — v1 audit-only parser
- `35150b4832096ad3eb11146a489f4dfe66e15672` — pure semantics comparator
- `a9f08b1e1d301aa6907141fc7cc99edc0c7bde18` — v1/v2 regression assertions
- `6e242b5353889bb7e2a62bec52148774dd247ec7` — full archive scanner
- `13d77eecd256252bf57f6aa79bbf9aaeada70442` — package command

## 検証

- v1/v2 synthetic archiveをNode 24のTypeScript strip実行でruntime smoke: **PASS**
- v1: 特払い券種lineなし、後続exacta/trifectaがreturned=true
- v2: win special_payout=70、後続exacta/trifectaはreturned=false
- 新規scanner/helper/testの構文check: **PASS**
- full unit/typecheck/build: **PENDING**（GitHub Actions run/status未生成、raw archiveを持つlocal checkout未接続）

## Non-blocking label hardening

raw archiveが未接続でも確定できる別のlabel契約bugを修正した。

- `partially_refunded` はeligibleだが、旧 `deriveBetLabel` は返還対象selectionを受け取れず `hit=0 / payout=0` にしていた
- special payoutもwinning selectionを持たないため、旧契約のままselection列挙すると全件lossになり得た
- target contractを `n2-target-contract-v2` へ上げ、`outcome=hit/loss/refund/special_payout/void` を追加
- refund / special_payout / void は `hit=null`。financial targetだけに実返還/特払額を保持し、金額不明を100円へ推測補完しない
- Node 24 contract test: 10 pass / 0 fail

commit: `947f9224153f23130181f212a9a7a0dad5b45e9d` (contract), `4aefcee1f4caf9a005d7507eea83022aeaa56b01` (test), `a32fc1f1d407e9fc8ce7e3aecc1deef65f9e591a` (docs)

## Selection-level prototype foundation

- 全7券種のcanonical selection空間を決定順で列挙: win 6 / place 6 / exacta 30 / quinella 15 / trifecta 120 / trio 20 / wide 15（計212）
- ordered券種は順列、unordered券種は昇順組合せ、艇番重複なし
- `deriveSelectionLevelLabels`で全selectionを実際に`deriveBetLabel`へ通す
- exacta fixtureで通常=1 hit+29 loss、部分返還=1 hit+1 refund+28 loss、特払い=30 special_payout、全返還=30 voidを固定
- targeted TypeScript strict check: PASS / Node 24 contract tests: 10 pass

commit: `3b32ab33b45f679dda64a41935cd281585afad94` (enumerator), `a7be4cf057ff15094a0bba3067336f3cac2ac2c1` (tests)

実DBの券種別class balance・hit率・payout分布はまだ未生成。既存candidate-level profileをselection-level実測と呼ばない。

## Independent selection profile rebuild

- `buildN2SelectionProfile`: 全selectionのoutcome/class balance/hit率/正の払戻分布/digestを純関数集計
- payout・special payout・refundの金額競合はfail-closed
- `profile:n2:selection-labels`: immutable sidecarを独立に2回openし、1回目close後のDB/入力再読込でdigest・件数・券種別profileを比較
- 現sidecarの出力は必ず`STALE_ARCHIVE_SEMANTICS`。archive訂正前にtraining truthへ昇格しない
- isolated SQLite end-to-end fixture: 4 candidates / 120 selections / independent rebuild PASS
- profile unit tests: 4 pass / targeted strict typecheck: PASS / script syntax: PASS

commit: `2e4dcbfb7aec033b615a432b9678ddfe0edad644` (builder), `368787bf6524034a8410890b70ffd1a6794e853d` (tests), `e3e5c9fb7465a185e3daa43b966a0a51bbf07dbe` (DB reader), `b5c6beccd3c44b00ebe0030264edf275e78d8665` (strict type fix)

## Non-blocking hardening: odds atomic PIT guard

raw archive未接続中の独立sliceとして、旧`validateOddsUsage(kind, role)`がlive checkpointの実時刻を検証しない契約不一致を修正した。新guardはkind/role/capturedAt/availableAt/decisionCutoffを一体で検証し、cutoff後・時刻矛盾・欠損をfail-closedにする。closingは価格評価専用のまま。本変更はarchive再集計値、DB、production判定へ影響しない。

- Node 24 contract tests: 12 pass / 0 fail
- targeted TypeScript strict check: PASS
- feature builderへの接続: PENDING

## 次gate

1. `--limit=20` smoke scan + full repo unit/typecheck
2. raw archive全件を再parseし、`year × bet_type × event_kind`を確定
3. 319,301候補とのcanonical/source-duplicate reconciliationを取る
4. append-only `parser_reparse` / supersession計画をtemp copyで検証
5. corrected canonical label profileを独立DB再読込で再生成
6. その後にselection-level N2 prototypeへ進む

## 安全

- 実DB、primary DB、sidecar、archiveへのwriteなし
- existing v1 evidenceの削除・上書きなし
- collector、production判定、BUY/WATCH/SKIP、自動投票への変更なし
