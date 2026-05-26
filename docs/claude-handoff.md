# Claude Code 引き継ぎメモ

最終更新: 2026-05-26 (セッション13 v4検証・不採用・v3確定)

Boat Pon は個人用の期待値通知・検証アプリ。自動購入、自動投票、ログイン保存、投票サイト操作は絶対に実装しない。

## 現在の状態

- リポジトリ: `/Users/m-shogo/Developer/personal/boat-pon`
- ブランチ: `main`

### モデル・フィルター（確定済み）

- **model_version: boatpon-v3-alpha15**（v4検証・外部検証で不採用 → v3で確定）
- 現行フィルター（`app_settings.budget_rule`）:
  - `allowedClassNames`: ["B1"]
  - `minRequiredOdds`: 25
  - `classOddsRatioRules`: B1 → maxOddsRatio=1.5
  - `excludedVenues`: 戸田・多摩川・桐生・三国・江戸川（5会場）
  - `excludedRaceNos`: [11, 12]
  - `minFirstBoatNationalWinRate`: 4.0
  - `excludeSameClassSecondBoat`: false

### 外部検証結果（2020-2023 pseudo-BUY基準）

| 条件 | ROI | 備考 |
|------|-----|------|
| 現行フィルター全部 | 0.939 | 確定・これ以上改善不可と判断 |
| v4-conservative | 0.720 | BUY数1/3なのにROI同等 → 不採用 |
| A2追加 | 0.663 | B1単独0.937に劣る → 不採用 |
| 土曜除外 | 0.866 | 2022=1.074と逆転 → 不採用 |
| 追加会場除外 | 0.875 | n17%減で改善幅小 → 不採用 |

外部ROI=0.939 はランダムベット0.74より改善しているが breakeven 1.0 に届かない。
原因: cherry-picking バイアス + 逆選択（構造的問題、パラメータ調整では解消不可）。

### 2026ライブ監視状態（2026-05-26時点）

- launchd: `com.boatpon.auto-odds`（15分毎 9:00-21:00 JST）、`com.boatpon.daily-programs`、`com.boatpon.daily-results` 稼働中
- 2026 v3 BUY累計: **0件**（本日2026-05-26より蓄積開始）
- 予想ペース: 約222件/月 → n=300 に約42日（2026年7月初旬目安）
- 2026年の古いBUY（v2: 43件）は別 model_version なので混ぜない

### DBの状態

- メインDB: `data/boat.sqlite`
- `data/boat-pon.db`: 0バイトダミー（使わない）
- decision_history（全期間）:
  - v3-alpha15 BUY: 約6,400件（2024-2025年）
  - 2025年: BUY 2,443件、WATCH 1,420件、SKIP 23,839件
  - 2024年: BUY 3,957件、WATCH 1,947件、SKIP 49,795件

### テスト・ビルド

```sh
npm test      # 71件全件パス
npm run build # 成功
npm run verify:full  # verify + db:health + monitor:live + gitleaks
```

## 次のマイルストーン

**n=300 ライブBUY蓄積まで待つ（2026年7月初旬目安）**

それまでにやれること:
- 特になし。パラメータ最適化の余地は外部検証で尽きた
- ライブBUYが溜まったら: ROI確認 → 有意差検定（片側）→ 継続/見直し判断

## 触らないもの

- `data/raw/official/`
- `data/tmp/`
- `npm run fetch:official-results`
- `npm run fetch:official-programs`
- `npm run fetch:kyotei24`
- `npm run generate:history`（2026年対象は禁止）
- `app_settings` の変更（承認なし）
- `pkill` / `kill` / `rm` / `git reset` / `git checkout --`

## ROI計算の注意

```sql
-- 正しい（current_odds基準）
SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END) / COUNT(*)

-- 禁止（payout_yen は使わない）
SUM(payout_yen) / (COUNT(*) * 100)
```

## DBスキーマ注意

- `odds_snapshots`: captured_at は2026（バックフィル実施年）。レース年は `substr(race_id,1,4)` で判定
- `decision_history`: model_version で必ず分離。v2/v3/v4 を混ぜてROI計算しない
- `listOddsSnapshots(db)`: LIMIT なし、MAX(id) GROUP BY race_id, selection で最新1件
- `recordOddsSnapshot`: DELETE→INSERT で重複しない

## 新規スクリプト（セッション13追加）

- `scripts/evaluate-v4-conservative.ts`: 読み取り専用v4評価（DB書き込みなし）
- `scripts/check-db-health.ts`: DBヘルスチェック（読み取り専用）
- npm scripts: `evaluate:v4`, `db:health`, `verify:full`

## 過去の検証結論まとめ

詳細は `docs/lessons-learned.md`、`docs/model-roadmap.md` を参照。

| 試みた変更 | 結果 | セッション |
|-----------|------|-----------|
| alpha=20 | in-sample ROI低下 | セッション8 |
| req>=30 | 外部ROI悪化 | セッション9 |
| ratio<1.3 | 外部ROI悪化 | セッション10 |
| marketBlendWeight | 効果限定的 | セッション2 |
| A2追加 | 外部ROI=0.663 | セッション12 |
| 2号艇≠B1 | 外部ROI=0.786（逆転） | セッション12 |
| 土曜除外 | 外部ROI=0.866（不安定） | セッション12 |
| 追加会場除外 | n減・改善幅小 | セッション12 |
| v4-conservative | BUY86%減・ROI同等 | セッション13 |
