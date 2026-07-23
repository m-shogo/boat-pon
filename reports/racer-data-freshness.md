# 選手データ鮮度レポート

生成日時: 2026-07-20T08:23:48.202Z

## サマリー

| 項目 | 値 |
|---|---|
| racer_profiles 総件数 | 2660 件 |
| racer_profiles 最新取得 | 2026-07-19 20:05 UTC |
| racer_profiles 最古取得 | 2026-07-12 22:54 UTC |
| racer_profiles 7日超 | 2543 件 |
| racer_profiles 14日超 | 0 件 |
| racer_profiles null | 0 件 |
| racer_course_stats 総行数 | 9840 行 |
| racer_course_stats 登録選手 | 1640 人 |
| racer_course_stats 最新取得 | 2026-07-13 08:40 UTC |
| racer_course_stats 最古取得 | 2026-06-07 21:35 UTC |
| racer_course_stats 7日超 | 9312 件 |
| racer_course_stats 14日超 | 18 件 |
| weekly launchd | ✅ ロード済み |
| ログ最終更新 | 2026-07-19 20:05 UTC |

## F歴判定 (headFlyingCount) の信頼度

> 🟢 **HIGH**: forward期間の対象選手全員のflying_countが取得済みで14日超なし

> ℹ️ flying_count が NULL の場合、isBase/wind5 条件では `?? 0` で headF=0 扱いになる。
> NULL選手が 1号艇に入ると headF=0 条件を誤って通過する可能性がある。

## isBase / wind5 対象選手の鮮度

| 対象 | 選手数 | 7日超 | flying_count NULL | profiles未登録 | headF影響可能性 |
|---|---:|---:|---:|---:|---:|
| isBase (直近90日) | 574 | 573 | 2 | 0 | 2 |
| wind5 (直近90日) | 224 | 224 | 1 | 0 | 1 |
| paper forward期間 (2025-08-09以降) | 25 | 25 | 0 | 0 | 0 |

> profiles未登録・flying_count NULL の選手は引退選手または履歴期間前の選手が大半。

## paper forward期間の実データ範囲

| 項目 | 値 |
|---|---|
| 基準日 (FORWARD_START) | 2025-08-09 |
| 実データ最古 | 2025-08-09 |
| 実データ最新 | 2025-08-12 |
| 対象レース数 | 25 件 |

## launchd 週次自動更新

- **ラベル**: `com.boatpon.weekly-racer-stats`
- **スケジュール**: 毎週月曜 05:00 JST
- **状態**: ✅ ロード済み (自動更新有効)

## 直近ログ

**最終更新**: 2026-07-19 20:05 UTC

```
[2/2683] 1485 加藤峻二 ST=undefined F=null
[3/2681] 1759 酒井忠義 ST=undefined F=null
[4/2681] 1781 谷川宏之 ST=undefined F=null
[5/2681] 1825 森 満弘 ST=undefined F=null
完了: fetched=28 skipped=2655 failed=0
```

**エラーログ (直近5行)**:

```
error: 2034 谷口 誠 fetch failed
error: 2036 倉重宏明 fetch failed
error: 2042 金井秀夫 fetch failed
error: 2044 友永健策 fetch failed
error: 2046 榊原利行 fetch failed
```

## 判定・推奨アクション

> ⚠️ **RUN_FETCH**: pnpm fetch:racer-stats を実行 (理由: 14日超の古いデータあり: course_stats 18件)

- **今すぐ fetch:racer-stats 必要**: ⚠️ YES
  - 理由: 14日超の古いデータあり: course_stats 18件
