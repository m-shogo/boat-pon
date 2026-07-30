# N2 Readiness Gate Checklist（着手前・設計のみ）

更新: 2026-07-30
状態: **N2 未着手（model/training/tuning は行わない）**

N1-C（全券種 settlement canonical 基盤）完成を受け、N2（市場残差/選手能力等を用いた予測・評価フェーズ）へ進む前に満たすべき gate を、repo・docs・schema・reports から整理する。本書は checklist であり、N2 実装・training・BUY/WATCH/SKIP・threshold 変更・production 接続は一切行わない。

## N1 が N2 へ提供するもの（READY）

| 項目 | 状態 | 根拠 |
|---|---|---|
| settlement truth（全7券種、payout/refund/status） | READY | 8,170/8,170、candidates 8.16M、integrity ok/fk 0 |
| canonical active view（重複排除済み） | READY | active canonical race-level uniqueness=0、source_duplicate resolution |
| raw provenance / evidence lineage | READY | capture→raw→parse→observation→candidate、append-only、raw immutable |
| post-race leakage boundary | READY | observation type=post_race（leakage sentinel test） |
| revision/refund/cancellation/conflict の表現 | READY | status axis（settled/refunded/partially_refunded/cancelled/no_sale/pending）、conflict group、revision kind |
| reproducibility（決定的再構築） | READY | source archive immutable＋deterministic backfill/resolution |
| value 整合（legacy 照合） | READY | payout mismatch 0（sample 2,000） |

## N2 着手前に必要な gate（MISSING / TODO — 実装は別承認）

1. **training dataset contract** — canonical active settlement を train label とする正式 contract（race-level grouping、held-out period、train/valid/test split、venue/year drift 分離）は未定義。**MISSING**。
2. **feature timestamp / PIT contract for features** — settlement は post-race で確定済みだが、N2 の feature（市場 odds、選手能力、beforeinfo 等）の as-of/PIT 境界と leakage test は F0 の manifest/resolver を再利用する設計が必要。**PARTIAL**（F0 PIT 基盤あり、N2 feature 適用は未接続）。
3. **target definition** — 予測対象（的中/払戻/ROI いずれか、券種・買い目粒度）が未確定。**MISSING**。
4. **unresolved settlement handling** — pending/source_conflict/quarantined を training からどう除外/扱うかの規則。**MISSING**。
5. **market odds timing** — 締切前 odds（current_odds、gap 14.94pt 楽観バイアス既知）と実払戻の分離利用規則（CLAUDE.md ROI 評価基準）を N2 feature/label に適用する contract。**PARTIAL**（評価基準は既存、N2 適用未定義）。
6. **ROI evaluation / calibration harness** — walk-forward、calibration、drawdown を canonical settlement 基準で評価する harness。**PARTIAL**（既存 ROI/calibration script あり、canonical settlement 接続未定義）。
7. **leakage tests for N2 features** — feature 側の post-race/current-profile/historical-closing 誤用の自動検出。**PARTIAL**（F0 leakage guard あり、N2 未接続）。
8. **capacity/quota for feature store** — N2 feature を持つ場合の追加容量見積り（現 sidecar は settlement のみ）。**MISSING**。

## 推奨 next step（実装ではなく設計）

1. N2 training dataset contract 設計（race-level split、drift、PIT feature boundary）を先に文書化。
2. target/評価指標を CLAUDE.md ROI 基準（実払戻ベース、gap≥10pt で current_odds 不信頼）と整合させて確定。
3. feature 側 leakage test を F0 manifest/resolver で再利用する設計。
4. 上記が固まってから初めて N2 実装承認を得る。

## 禁止（本フェーズ）

model training/tuning、BUY/WATCH/SKIP logic 変更、threshold tuning、production 接続、automatic betting、feature store 実装、N2 schema 追加。すべて別の明示承認まで着手しない。
