# 2連単 future-only パイプライン監査

- 生成: 2026-07-20T13:20:44.908Z
- 判定: **BLOCKED**
- 候補ロック日: 2026-06-12
- 読み取り専用監査。本番判定・DBスキーマ・収集ジョブは変更していない。

## 結論

現在のexacta市場残差・固定候補モニターは、名前に反してfuture-only価格データを自然増加させる経路になっていない。H011の固定1点ROI監視はpaper-liveへ修正済みだが、市場価格を使う候補は収集・保存・監視の接続修正が先。

- ❌ odds_timeseries_snapshots に bet_type がなく、2連単と2連複の同形selectionを安全に区別できない
- ❌ 稼働中のT-5収集は3連単公式ページだけを取得し、2連単を取得していない
- ❌ 固定2連単モニターはT-5時系列ではなく historical closing odds を参照している

公式2連単HTMLを2連複と分離して30通り抽出するパーサーと単体テストは追加済み。ただし収集ジョブへの接続とDB書き込みは、この監査では有効化していない。

## 実データの証拠

- 直近5000行: 3連単形=5000、2連単形=0
- 最新行: 20260720-徳山-12 / 6-5-4 / T-10 / 2026-07-20T11:35:25.258Z
- timeseries列: id, race_id, selection, odds, popularity, source, captured_at, minutes_before_close, checkpoint_label, created_at
- source: official=5000

### 候補ロック日以降のdecision_history

| run_kind | decision | n | min | max |
|---|---:|---:|---:|---:|
| paper-live | BUY | 4 | 2026-07-20 | 2026-07-20 |
| paper-live | SKIP | 4680 | 2026-06-12 | 2026-07-20 |
| paper-live | WATCH | 55 | 2026-06-13 | 2026-07-20 |

## 修正の順序

1. 券種を主キー・一意性・検索条件に含めるbet-type-awareな前向きオッズ保存先を設計する
2. 公式odds2tfの2連単30通りをT-20/T-5等のcheckpointで収集し、2連複を混入させない
3. 固定候補モニターをpaper-live判定と同時点の2連単オッズへ接続する
4. 結果確定後にexacta払戻と結合し、欠測・返還・フライングを別状態として監視する
5. 十分なfuture-only標本が貯まるまでBUY・app_settings・本番decisionへ接続しない

## 安全境界

- 2連単パーサー追加まで実施。自動収集・DB migration・本番判断への接続は未実施。
- 現スキーマへselection文字列だけで2連単を混在させない。2連複と衝突し、券種別品質監査ができなくなるため。
