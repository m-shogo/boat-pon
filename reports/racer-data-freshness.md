# 選手データ鮮度レポート

生成日時: 2026-06-08T06:38:04.440Z

## サマリー

| 項目 | 値 |
|---|---|
| racer_profiles 総件数 | 2657 件 |
| racer_profiles 最新取得 | 2026-06-08 05:41 UTC |
| racer_profiles 最古取得 | 2026-05-29 07:29 UTC |
| racer_profiles 7日超 | 24 件 |
| racer_profiles 14日超 | 0 件 |
| racer_profiles null | 0 件 |
| racer_course_stats 総行数 | 9822 行 |
| racer_course_stats 登録選手 | 1637 人 |
| racer_course_stats 最新取得 | 2026-06-08 05:41 UTC |
| racer_course_stats 最古取得 | 2026-05-29 07:29 UTC |
| racer_course_stats 7日超 | 102 件 |
| racer_course_stats 14日超 | 0 件 |
| weekly launchd | ✅ ロード済み |
| ログ最終更新 | 2026-06-08 05:41 UTC |

## F歴判定 (headFlyingCount) の信頼度

> 🟢 **HIGH**: forward期間の対象選手全員のflying_countが取得済みで14日超なし

> ℹ️ flying_count が NULL の場合、isBase/wind5 条件では `?? 0` で headF=0 扱いになる。
> NULL選手が 1号艇に入ると headF=0 条件を誤って通過する可能性がある。

## isBase / wind5 対象選手の鮮度

| 対象 | 選手数 | 7日超 | flying_count NULL | profiles未登録 | headF影響可能性 |
|---|---:|---:|---:|---:|---:|
| isBase (直近90日) | 1052 | 10 | 1 | 0 | 1 |
| wind5 (直近90日) | 465 | 4 | 0 | 0 | 0 |
| paper forward期間 (2025-08-09以降) | 25 | 0 | 0 | 0 | 0 |

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

**最終更新**: 2026-06-08 05:41 UTC

```
[2450/2658] 5286 坂井滉哉 ST=0.16 F=1
[2500/2658] 5336 瀬川大地 ST=0.19 F=0
[2550/2658] 5386 米玉利大 ST=0 F=0
[2600/2658] 5437 中澤里桜 ST=0 F=0
完了: fetched=2633 skipped=22 failed=25
```

**エラーログ (直近5行)**:

```
error: 3871 池田紫乃 fetch failed
error: 3872 岡田憲行 fetch failed
error: 3873 別府昌樹 fetch failed
error: 3874 山本寛久 fetch failed
error: 3875 廣中良一 fetch failed
```

## 判定・推奨アクション

> ✅ **NO_ACTION**: launchd稼働中、データ鮮度は正常範囲。次回自動更新まで待機

- **今すぐ fetch:racer-stats 必要**: ✅ NO
  - 理由: 本日または直近実行済み、14日超なし
