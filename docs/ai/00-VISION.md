# Boat Pon Vision

Claude/Codex がこのリポジトリで作業する前に読む、最上位の方針文書です。
詳細な運用ルールはリポジトリ直下の `CLAUDE.md` を参照してください。ここに書くのは変わらない前提です。

## Mission

Boat Pon は「競艇予想アプリ」ではありません。

長期的に利益が期待できる仮説（Expected Value）を継続的に発見・検証・運用・監視・改善する研究プラットフォームです。

目標は:

- 的中率ではない
- 一時的なROIでもない
- 継続的に再現できる期待値を発見すること

## AIの役割

作業する AI は以下として振る舞います。

- シニアソフトウェアアーキテクト
- クオンツリサーチャー
- データサイエンティスト
- 機械学習エンジニア
- 品質保証エンジニア

ギャンブルアプリではなく「研究プラットフォーム」として設計・実装します。

## 最優先順位

1. データ品質
2. Future Leak防止
3. 統計的妥当性
4. 再現性
5. ROI向上
6. Explainability
7. 長期運用
8. テスト
9. UI
10. 装飾

## 絶対原則

### Future Leak禁止

未来情報を絶対に使用しない。使えるのは「レース開始前に取得可能だった情報のみ」。

### Data Snooping禁止

大量探索して偶然見つかったルールをそのまま採用しない。必ず

```text
Backtest → Forward Test → Review → Production
```

を通す。

### Overfitting禁止

小さなサンプルだけで強いルールと判断しない。

### ROIだけで判断しない

必ず ROI / Sample Size / Stability / Variance / Drawdown / Confidence Interval / Bayesian Estimate を合わせて評価する。

### ブラックボックス禁止

全ての予測に理由・根拠・使用特徴量・信頼度・リスクを表示する。

### 生データ保護

Raw Data は更新・削除・上書きしない。解析用テーブルを別に作る。

### 仮説を削除しない

仮説は必ず履歴を保持する。Archive のみ許可（削除禁止）。

### AI単独判断禁止

AIだけでルール採用は禁止。必ず 統計 → Forward → Review を通す。

## 成功条件

「予想を当てるアプリ」ではなく「競艇市場を研究するためのプラットフォーム」になること。

- 継続的に新しい期待値を発見できる
- 市場変化を自動検知できる
- 仮説を科学的に検証できる
- 長期ROIを改善し続けられる
- 全ての判断理由を説明できる
- 数年後でも完全に再現できる研究結果を保持できる

## この文書群の構成

- `00-VISION.md`（このファイル） — 変わらない目的・原則
- `01-ARCHITECTURE.md` — レイヤー構造と現在のコードのマッピング
- `02-DEVELOPMENT.md` — 開発ルール・実装の進め方
- `03-RESEARCH.md` — Research Engine の機能一覧と実装状況
- `04-ROADMAP.md` — Phase分割されたロードマップと進捗
- `05-VERIFICATION.md` — 検証チェックリスト（Local/CI/Manual smoke test、既知のブロック環境、Phase移行前の必須コマンド）
- `06-FABLE-READINESS.md` — Fable導入判断メモ（任せるべきこと/任せてはいけないこと、導入前条件）

既存の詳細ドキュメント（`docs/architecture.md`, `docs/rule-candidates.md`, `docs/decision-audit-roadmap.md` など）は残したまま、この `docs/ai/` は「迷ったらまずここを読む」ためのエントリポイントとして追加しています。
