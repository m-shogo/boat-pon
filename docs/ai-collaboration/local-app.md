# 最初の連携: MacのCodexアプリ → Claude Code

Codexアプリが実装と進行を担当し、Claude Codeをレビュー用に呼び出す。
Codex CLIを別途起動する必要はない。会話内容をコピーする作業やクラウドDBは不要。

## Codexアプリで開始

MacのCodexアプリで、ローカルの `/Users/m-shogo/Developer/personal/boat-pon` を選んで新しい作業を開始する。
UIの名称はバージョンによって異なるため、「ローカルで実行されているか」を基準に確認する。
クラウドの `/workspace/boat-pon` ではMacのCLIを呼べない。

最初の依頼として次を貼り付ける:

```text
このMacのローカル作業として、CodexアプリからClaude Codeへの連携を確認してください。
作業場所は /Users/m-shogo/Developer/personal/boat-pon です。
まずpwdとgit statusを確認し、既存変更を保全してください。
originのagent/codex-claude-collaborationを取得し、必要なら別worktreeで作業してください。
AGENTS.mdとdocs/ai-collaboration/local-app.mdを読み、Claude Codeの導入・認証を確認し、
node scripts/ai-collaboration/review-local.mjs --task AI-first-connection --smoke
で接続確認してください。同じ依頼IDで最大3回、失敗時の自動再試行は禁止です。
APIキーや課金APIには切り替えないでください。未導入なら公式の導入方法を確認してください。
対話ログインが必要な場合だけ私に操作を案内し、その後に確認を再開してください。
DB・LINE・財布ルールは変更しないでください。mainへのpushは禁止です。
```

Claude Codeが未導入なら、Mac側のエージェントが公式の導入手順を確認する。
対話ログインは本人が行う。通常の月額チャット契約だけで全プランのCLI利用を保証しない。
Claude Codeを利用できるプランかと利用枠を確認する。追加のAPIキーは設定しない。

## 接続後のコードレビュー

Codexが変更前のcommit SHAを保存し、実装後に同じ作業用ディレクトリから呼ぶ。

```bash
node scripts/ai-collaboration/review-local.mjs --task AI-miss-review-001 --base <変更前の40桁commitSHA>
```

既定は`--base HEAD`で、stagedとunstagedを合わせた差分を送る。実装後commitした場合は
変更前SHAを明示する。HEADだけを比較して空差分を承認済みと扱わない。
初版の対象はmiss-reviewの実装2ファイル・テスト2ファイルだけ。
他ファイルは送信されず、レビュー済みとは扱わない。

JSONの`review.issues`をCodexが読み、`revise`なら修正して再度呼ぶ。
`blocked`は自動修正の承認ではない。上限は同じ依頼で合計3回、失敗も1回と数える。
接続テストは別の依頼で、コードレビューやテスト成功の代わりにはしない。

## 接続時の制限

- Claude Codeは空の一時ディレクトリで実行し、差分だけをstdinへ渡す。
- toolsを空にし、MCP・hooks・通常のsettings読込・セッション保存を無効化する。
  対応するCLIフラグがない旧版では停止する。権限チェックの迂回オプションは使わない。
- APIキー、API接続先、クラウドプロバイダー設定、GitHub/LINEトークンは子プロセスへ継承しない。
  `auth status`が`claude.ai`のログインを示す場合だけ呼び出す。API方式へfallbackしない。
- HOME等のログイン用OS設定は必要。これはOSレベルの完全な隔離ではなく、CLIのツール制限。
  レビュー機能にはDBの読取・編集ツールを提供せず、DB内容や`.env`を入力に含めない。
- タイムアウト180秒、1回のCLI実行は最大1ターン。利用枠切れや不正JSONで停止する。
- 結果はGit管理外の `data/tmp/ai-local-review/<依頼ID>/round-N/` に保存する。
  一時停止・クラッシュで`running`が残った場合は自動再開せず、記録を確認する。

DBは元のMacに残る。Codexからの実DBレポート実行は別の読み取り専用作業として扱い、
このClaude接続テストがDB検証まで済ませたと報告しない。
承認後も必要なテスト・境界チェックを行い、依頼されたブランチだけへcommit/pushする。
