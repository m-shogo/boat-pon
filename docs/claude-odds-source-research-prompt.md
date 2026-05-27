# Claude Code向け: 過去オッズ取得元の深掘り調査プロンプト

以下をClaude Codeへそのまま貼り付ける。

```text
作業場所は必ず /Users/m-shogo/Developer/personal/boat-pon にしてください。
最初に `pwd` と `git status --short --branch` を確認してください。

目的:
Boat Ponで2018年など古い年の3連単オッズを検証に使えるか調査する。
コード変更・DB書き込み・大量取得はしない。今回は「調査だけ」。

背景:
- 2018年の official_programs / race_results はDBにある。
- ただし2018年 race_id の odds_snapshots は0件。
- このモデルは市場オッズとの比較が重要なので、結果だけでは本番に近い検証にならない。
- 既存記録では kyotei24 過去オッズは2020/2021でも一部限界がある。

絶対禁止:
- data/ 以下へ大量保存しない
- DBへ INSERT / UPDATE / DELETE しない
- npm run backfill:odds / fetch:pending / fetch:official-results / fetch:official-programs を実行しない
- 自動購入・投票サイト・ログイン・認証情報に触れない
- robots.txtや利用規約に反するアクセスをしない
- 高頻度アクセスしない。疎通確認する場合も数URLだけ、curl -I またはブラウザ確認中心

調査対象:
1. kyotei24 の過去3連単オッズURLが2018年でも存在するか
   - 既存コード `src/domain/kyotei24Odds.ts` と `scripts/backfill-odds.ts` を読んでURL形式を確認
   - 2018年の数レースだけURL候補を作り、存在可否を調べる
2. BOATRACE公式に過去オッズページがあるか
   - 公式URL形式と保存範囲を確認
   - 2018年レースでアクセス可能か調べる
3. その他の過去オッズ提供元
   - 競艇/ボートレース 3連単 オッズ 過去
   - boat race trifecta odds archive
   - odds archive kyotei
   - 競艇倶楽部、kyotei24、BOAT RACE公式以外も含める
   - 無料/有料/API/スクレイピング可否/利用規約/保存期間を分ける
4. 2018年を使えない場合の代替
   - 2020-2023の既存外部検証で十分か
   - 2022-2023だけ追加精査する価値があるか
   - 2026ライブを待つ方が合理的か

成果物:
`docs/odds-source-research-YYYY-MM-DD.md` を新規作成し、以下を書く。

必須項目:
- 結論: 2018年オッズは取れる/取れない/不明
- 調査したサイト一覧
- 各サイトのURL、保存期間、アクセス可否、利用条件、懸念
- 実際に確認したURL候補とHTTPステータス/表示結果
- 取得できる場合の最小実装案
- 取得できない場合の代替案
- 大量取得するなら必要なユーザー承認事項

最後に:
- 変更ファイル
- 実行したコマンド
- 実行していない危険コマンド
- 次にCodexレビューへ回すべき論点

注意:
外部サイトの記述は必ずURL付きで出典を残す。
不確かな推測は「推測」と明記する。
```
