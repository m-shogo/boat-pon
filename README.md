# Boat Pon

Boat Pon は、競艇の期待値通知アプリ「Boat EV Notifier」の個人用実装です。

自動購入・自動投票・ログイン情報保存・投票サイト操作は実装しません。  
BUY / WATCH / SKIP の判定、公式確認リンク、raw/JSON/SQLite保存、後日の検証を目的にします。

## 開発

```sh
npm install
npm run dev
```

## Phase 1 MVP

- kyotei24 結果ページを低頻度で取得して raw 保存
- raw HTML を normalized JSON へ変換
- SQLite へ保存
- ダッシュボードで結果と候補判定を表示
- 推定的中率、必要オッズ、EV、BUY / WATCH / SKIP を扱う
- 公式確認リンクは外部リンクのみ

## 安全仕様

- 自動購入なし
- 自動投票なし
- ログイン情報保存なし
- 投票サイト操作なし
- 全会場全レースの毎分取得なし
- オッズ全パターンの連打取得なし
- BUY候補なしの日を成功扱い
