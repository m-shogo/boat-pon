# Codex・Claude 連携の導入

この文書は新しいコード改善レーンの手順。既存の研究キューやその承認権限を変更しない。
DB、賭け金、BUY/SKIP、LINE送信、app_settings、自動投票を変更する権限はない。

## 現在できること／まだできないこと

実装済み:

- `npm run ai:doctor`: Mac、DBのファイル存在、Codex CLI／Claude Codeの導入・ログイン状態を診断。
  DBは開かず、CLIの認証出力・アカウント情報・秘密鍵は表示しない。
- `npm run ai:check`: 通信せずに、依頼検証・最新コミットとの一致・編集対象を確認する。
- 連携コア: Codexの修正案 → Claudeのレビュー → 指摘の再修正、最大3往復。
  レビュー対象を修正案のdigestに固定し、古い承認の流用を防ぐ。
- 任意のAPI接続アダプター。実行フラグと認証設定がなければ呼び出さない。
  モデルには渡したソース文字列だけが見え、シェル・ファイル・DB操作ツールは提供しない。
- 実行ごとの記録と重複実行防止。失敗後の自動再試行・連続dispatchは行わない。

未接続:

- 通常のチャットの会話同士の同期。
- 契約の利用枠で動くCLIアダプター。診断の成功は連携実行の成功ではない。
- 自動PR作成、Macでの隔離実データ検証、自動merge。
- GitHub Actionsからの新しい起動経路。既存のself-hosted runnerへ依頼を送らない。

**まだ全自動で接続された状態ではない。** `REVIEW_PASSED`はAIのレビュー通過に限り、
テスト成功・実データ検証・反映の許可を意味しない。実データ検証は常に`PENDING_MAC`。

## Macで最初に行うこと

Macに未commitの変更がある場合はそのまま保全する。別の作業用ディレクトリを作ると、
普段のブランチを切り替えずに診断できる。以下は、この変更を含むブランチがpushされた後に実行する。
同名ディレクトリがすでに存在した場合は停止するので、削除や上書きはせず確認する。

```bash
cd /Users/m-shogo/Developer/personal/boat-pon
git fetch origin agent/codex-claude-collaboration
git worktree add --detach ../boat-pon-ai-setup FETCH_HEAD
node ../boat-pon-ai-setup/scripts/ai-collaboration/doctor.mjs
bash ../boat-pon-ai-setup/scripts/diagnose-boat-pon-self-hosted-runner.sh
```

元のディレクトリをcwdにして、新しいスクリプトだけを実行するため、元DBの存在を診断できる。
DBのコピーやシンボリックリンク、npm依存パッケージのインストールは不要。

`ai:doctor`はJSONを表示する。`SETUP_REQUIRED`なら`blockers`の不足項目を解消する。
`CLI_PREREQUISITES_PRESENT`でも、契約がCLI利用を含むか・利用枠・実モデルへの接続は未検証。
`runner:diagnose`は既存Macサービスの読み取り専用診断であり、新サービスは登録しない。
この2つの出力には秘密鍵を含めない。チャットに認証トークンや`.env`を貼り付けない。

ChatGPT／Claudeの月額契約とAPIの従量課金は別。追加課金なしを希望する場合は、
まず各契約でCodex CLI／Claude Codeが使えるかを確認し、対話ログインをMac上で行う。
CLIは通常ユーザーの権限で動くため、そのまま実DBの見える場所で無人運転しない。
CLI接続は隔離方法の実機検証が終わってから有効にする。

## 通信しない依頼確認

依頼ファイルのフィールドは3つだけ。`baseSha`には現在の40桁commit SHAを指定する。
依頼本文には個人情報・認証情報・実DBの内容を記載しない。

```json
{
  "id": "AI-miss-review-001",
  "baseSha": "ここを現在の40桁commit SHAへ置換",
  "goal": "miss-reviewの件数表示を読みやすくし、回帰テストを追加する"
}
```

ファイルはGit管理外の`data/tmp/request.json`などへ保存し、次を実行する。

```bash
npm run ai:check -- data/tmp/request.json
```

現段階の許可対象はmiss-reviewの実装2ファイル・テスト2ファイルだけ。
許可対象の拡張は別のコードレビューで行う。AIが対象・ルール・依存パッケージ・workflowを
書き換えて自分の権限を増やすことはできない。パス制限だけでは意味上の安全性は保証しないため、
Claudeレビュー・境界チェック・人が確認できるPRを省略しない。

## API方式を選ぶ場合のみ

通常の月額チャット契約にAPIキーが含まれるとは扱わない。
別途API利用を選んだ場合だけ、OpenAI／Anthropicそれぞれの公式管理画面で設定する。
秘密鍵はローカルの安全な認証設定で扱い、Gitや依頼ファイルへ書かない。

必要な環境変数は`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`BOAT_CODEX_MODEL`、`BOAT_CLAUDE_MODEL`。
モデル名は利用可能なものを公式に確認して指定する。固定のモデル名やプラン対応を推測しない。

```bash
node scripts/ai-collaboration/run.mjs data/tmp/request.json --execute
```

この明示的な実行だけがAPIへ依頼を送る。最大6回（各社3回）、各呼び出し180秒、
writer出力上限16,000 token／reviewer上限6,000 token。HTTPエラー、拒否、不正JSON、
上限到達で停止し、勝手に別モデルへ切り替えない。金額上限ではないため、提供元側にも
利用上限・通知を設定する。実DBや`.env`は読み込まず、許可された追跡済みソースだけ送信する。

結果は`data/tmp/ai-collaboration/<依頼ID>/`に保存する。ソース変更・commit・pushは行わない。
同じIDは再実行せず、途中失敗も記録を残す。記録を確認して、再依頼なら新しいIDを発行する。
生成されたJSONは未信頼の修正案として扱い、その中のコマンドを実行しない。

## 実データ検証をつなぐための条件

1. 元DBはMacに残す。Google Driveの同期DBや無料DBへの移行は行わない。
2. trustedな抽出処理だけが元DBをread-onlyで開く。候補コードに元DBをマウントしない。
3. 必要な列だけの検証データを用意する。全DBコピーにはapp_settings等が含まれ得るため、
   そのまま候補コードやAIへ渡さない。稼働中SQLiteの単純ファイルコピーも行わない。
4. 候補コードはネットワークと本番認証のない隔離環境で実行する。
5. 検証対象commit・データ時点・期間・結果を記録し、DB不在を0件や成功と扱わない。
6. 同じcommitへのClaude承認、必須テスト、境界チェック、Mac検証が揃って初めてPRを完成扱いにする。

既存の研究ルール（`docs/research-automation-operating-model.md`）の1実行1依頼、
自動再dispatchなし、財布ルールの自動昇格なしを維持する。
