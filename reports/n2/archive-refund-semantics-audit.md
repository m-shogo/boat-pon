# Archive refund semantics audit

更新: 2026-08-01  
状態: **CODE_PATH_FIXED / RAW_ARCHIVE_IMPACT_PENDING**

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

## 次gate

1. v1/v2を同じraw archiveへread-onlyで適用する差分scannerを追加
2. `year × bet_type × event_kind` で、v1 refund / v2 special_payout / true no-contest / unchangedを集計
3. raw archive全件で再parseし、319,301候補とのreconciliationを取る
4. append-only `parser_reparse` / supersession計画をtemp copyで検証
5. corrected canonical label profileを独立DB再読込で再生成
6. その後にselection-level N2 prototypeへ進む

## 安全

- 実DB、primary DB、sidecar、archiveへのwriteなし
- existing v1 evidenceの削除・上書きなし
- collector、production判定、BUY/WATCH/SKIP、自動投票への変更なし
