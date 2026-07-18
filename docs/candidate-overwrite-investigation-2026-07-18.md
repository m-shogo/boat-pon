# live候補上書き調査（2026-07-18）

## 結論

2026-07-18 18時台の再監査では、候補6,695行のうち買い目別オッズ不一致が6,510行、保存済みtop1一致が5/64（7.8%）だった。`--strict`監査はこの状態を失敗終了にし、研究結果を採用可能として扱わせない。

```bash
pnpm audit:candidate-selection -- --date 2026-07-18 --strict
```

`buildCandidatesFromModel` は、3連単オッズが揃ったレースについて最大120通りを返す。
現行のlive経路はそれらを順番に判定し、同一レースを `replaceRace` で保存するため、
モデル最上位ではなく配列末尾側の弱い候補が `decision_history` に残り得る。

2026-07-18の読み取り専用再計算では、対象179レースを1レース1候補にすると
選択はすべて `1-2-3`、判定は `WATCH=15 / SKIP=164 / BUY=0` だった。
一方、修正前の履歴には6号艇頭など、推定率が極端に低い末尾側候補が多く残っていた。

## 安全な対応状況

- `selectTopModelCandidatePerRace` と単体テストを追加し、選択規則を研究用に固定した。
- productionの `server/candidates.ts` には接続していない。
- `app_settings` とDBは手動変更していない。
- 閾値を緩めても履歴検証ROIが改善しないため、BUY数だけを増やす変更はしない。

## 監査メモ

調査中に未コミットのproduction接続差分をLaunchAgentが読み、
`boatpon-v3-alpha16` として45件（WATCH 15 / SKIP 30 / BUY 0）が保存された。
接続差分は直ちに外し、現行モデル定数は `boatpon-v3-alpha15` に戻した。
DB行は削除・更新せず監査記録として残している。

## productionへ進める場合の条件

1. paper専用経路で1レース1候補を十分な期間蓄積する。
2. `payout_yen` 基準でsample size、月別、会場別、最大払戻除外ROIを確認する。
3. project ownerの明示承認後にだけlive接続とmodel version更新を行う。
