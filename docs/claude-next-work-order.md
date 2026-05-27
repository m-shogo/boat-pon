# Claude Code 次作業指示

最終更新: 2026-05-26（セッション13完了・作業なし）

## 現状

v4-conservative の検証・実装・不採用・v3 への戻しが 2026-05-26 に完了した。

外部検証（2020-2023）でパラメータ調整の余地は尽きた。
現行フィルター（B1+req>=25+ratio<1.5+5会場除外+winRate>=4.0+race≠11,12）が最良設定。
外部ROI=0.939（ランダム0.74より改善、breakeven未満）。

## 次のマイルストーン

**2026ライブ BUY n=300 蓄積を待つ（2026年7月初旬目安）**

それまでの積極的なコード変更・パラメータ探索は不要。
ライブデータが溜まり次第、ROI + 有意差検定で継続/見直しを判断する。

## 待ち中にやれる軽作業（必要になれば）

- `docs/` の古いファイル整理（odds-backfill-plan.md 等）
- テスト追加（純粋関数があれば）
- モニタリング UI の軽微な改善
- 過去オッズ取得元の深掘り調査は `docs/claude-odds-source-research-prompt.md` を使う

## 絶対禁止

- 自動購入・自動投票・ログイン保存・投票サイト操作を実装しない
- `fetch:official-results`, `fetch:official-programs`, `fetch:kyotei24` を勝手に実行しない
- `data/raw/official` を触らない
- 2026年対象の `generate:history` 書き込みをしない
- ROI検証に `payout_yen` を使わない。検証ROIは `current_odds` 基準に統一する
- `data/` と `.claude/` をコミットしない
- `app_settings` を承認なく変更しない

## 判断ルール（常時）

ユーザーに技術判断を丸投げしない。
まずコード・DBスキーマ・既存ドキュメントを読み、読み取りSQL・テスト・ビルドで確認する。

ユーザー確認が必要:
- 外部サイトへ大量アクセスする
- DBに大量 INSERT / UPDATE / DELETE する
- 2026年 live `decision_history` を書き込む
- `git reset`, `git checkout --`, `rm` など破壊的操作
- 秘密情報・認証・SSH/Git設定の変更

ユーザー確認が不要:
- 読み取り専用SQL
- テスト追加・型修正・ドキュメント整備
- `npm run verify:full`
- `npm run monitor:live`
- `gitleaks detect --no-banner --redact`
