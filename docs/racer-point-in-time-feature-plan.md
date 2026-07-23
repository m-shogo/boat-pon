# point-in-time 選手能力 feature store 設計案（将来用・今回は実装しない）

> 2026-07-23: Phase N0の全項目監査と保存設計は
> [`../reports/all-bet-type-data-feasibility.md`](../reports/all-bet-type-data-feasibility.md)、
> [`all-bet-type-data-acquisition-design.md`](all-bet-type-data-acquisition-design.md)、
> [`all-bet-type-schema-migration-design.md`](all-bet-type-schema-migration-design.md)
> へ統合した。本書の旧2table案をそのままmigrationせず、統合設計の6候補とstrict-prior guardを正本にする。

作成: 2026-06-13（データ基盤監査パックの成果物）
前提: **このドキュメントは設計案のみ。DB変更・migration・decision logic変更は行わない。**

## 1. 解決したい問題

- racer_profiles / racer_course_stats は現在値スナップショット1世代のみで、
  過去レースに当てると未来情報リークになる（docs/racer-ability-feature-safety.md 参照）
- `enrichFeatures`（server/db.ts）は registrationNo+course だけで JOIN し日付条件がないため、
  historical-backfill 再生成時にリークが構造的に発生する
- 級別（A1/A2/B1/B2）や期別成績は半年ごとに改定されるため、「いつ時点の値か」を持たないと
  historical 検証に使えない

## 2. 提案スキーマ（案）

### racer_ability_snapshots

```sql
CREATE TABLE racer_ability_snapshots (
  registration_no  TEXT NOT NULL,
  snapshot_date    TEXT NOT NULL,            -- 取得日（YYYY-MM-DD）
  effective_from   TEXT NOT NULL,            -- この値が有効になった日（期の開始日など）
  effective_to     TEXT,                     -- 次snapshotで閉じる。NULL = 現役値
  class_name       TEXT,                     -- A1/A2/B1/B2
  national_win_rate  REAL,
  national_top2_rate REAL,
  local_win_rate     REAL,                   -- 当地は会場別に持つなら別テーブル
  avg_st           REAL,
  ability_index    INTEGER,
  flying_count     INTEGER,
  late_start_count INTEGER,
  source_type      TEXT NOT NULL,            -- 'official_live' / 'official_program' / 'k_archive_reparse'
  source_quality   TEXT NOT NULL,            -- 'exact' / 'derived' / 'approximate'
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (registration_no, snapshot_date)
);
```

### racer_course_stats_snapshots

```sql
CREATE TABLE racer_course_stats_snapshots (
  registration_no TEXT NOT NULL,
  course          INTEGER NOT NULL,
  snapshot_date   TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  effective_to    TEXT,
  races           INTEGER,
  wins            INTEGER,
  win_rate        REAL,
  top3_rate       REAL,
  avg_st          REAL,
  entry_rate      REAL,
  start_order     REAL,
  source_type     TEXT NOT NULL,
  source_quality  TEXT NOT NULL,
  fetched_at      TEXT NOT NULL,
  PRIMARY KEY (registration_no, course, snapshot_date)
);
```

設計メモ:

- 既存 racer_profiles / racer_course_stats は live 用の「最新値ビュー」としてそのまま残す
  （decision live パスを壊さない）。snapshots は追記専用の履歴テーブル
- source_type / source_quality は race_weather / exhibition_data の既存慣例
  （official_live / exact など）に合わせる
- effective_from / effective_to を持つのは、級別・期別成績が「取得日」ではなく
  「適用期間」で意味を持つため。最初は effective_from = snapshot_date でよい
  （取得を続ければ区間が自然にできる）

## 3. JOIN 規約（最重要）

- **historical backtest では `snapshot_date <= race_date` を満たす最新 snapshot だけを JOIN する**

```sql
SELECT s.*
FROM racer_ability_snapshots s
WHERE s.registration_no = :reg
  AND s.snapshot_date <= :race_date
ORDER BY s.snapshot_date DESC
LIMIT 1
```

- snapshot が存在しない（= レース日より前の取得がない）場合は **null（中立）** とし、
  現在値でのフォールバックは禁止
- live 判定は最新 snapshot（または既存の racer_profiles）を使ってよい
- `enrichFeatures` を将来この規約に移行する場合、historical パスと live パスで
  ロード関数を分け、historical パスには race_date を必ず渡すシグネチャにする

## 4. 運用案

1. **今すぐ（schema変更なし）**: 週次バルク取得（bulk-fetch-racer-stats、launchd登録予定）を
   そのまま続ける。fetched_at が複数世代貯まれば、後から snapshots へ移行可能なよう
   **既存テーブルを UPDATE 上書きではなく、取得ログ（raw）も残す** 運用を検討
2. **schema追加時（要承認）**: snapshots テーブルを追加し、週次取得を snapshots へ追記。
   既存テーブルは「最新値」のマテリアライズとして維持
3. **過去の補完**: K アーカイブ（data-roadmap 参照）に2000年以降の各艇成績が未抽出で残っており、
   再パースすれば期別の擬似 snapshot（source_quality='derived'）を作れる可能性がある。
   raw_json の出走表掲載値（className/勝率）からも race_date 時点の値を逆引きできるため、
   「出走表由来の point-in-time 値」を第一級の historical ソースとする
4. **監査**: snapshots 導入後も `pnpm report:racer-ability-audit` を拡張して
   「snapshot_date > race_date の JOIN が0件であること」を機械チェックする

## 5. 実装済みの部分的対処（2026-06-13）

上記フルスキーマは未実装だが、以下を実装することで historical backtest への live-only 特徴量注入をコードレベルでブロックした（docs/racer-ability-feature-safety.md §5 参照）:

- `enrichFeatures` に `mode` パラメータを追加し、`"historical*"` では racer_profiles / racer_course_stats JOIN を行わない
- `assertNoLiveOnlyFeaturesForHistorical` / `assertBreakdownNeutralForHistorical` を decision 生成パスに挿入
- `check:point-in-time-safety` 静的スキャンを追加

これにより「現在値スナップショットを過去レースに注入しない」という規約はコードで強制されるようになった。
スナップショット履歴テーブルは、将来 historical 検証に live-only 特徴量を使いたい場合（= 級別変更をレース日単位で追いたい）になって初めて必要になる。

## 6. やらないこと（このフェーズの禁止事項の再確認)

- 今回のスキーマ追加・migration 実行
- これらの特徴量を使った BUY 条件作成・ROI 探索
- exacta forward candidates / monitor の条件変更
- app_settings 変更
