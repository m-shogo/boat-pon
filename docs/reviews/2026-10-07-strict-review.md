# boat-pon 厳格レビュー（2026-10-07）

対象: `main` = `2342494f`（#2285、2026-09-24）。ローカルは 1,656 コミット遅れていたため pull してから実施。
DB は読み取り専用（`immutable=1`）で参照し、書き込み・app_settings・本番 decision・launchd・GitHub 設定には触れていない。

## 結論

1. **利益が出る優位性（edge）は無い。** 7月に事前登録した決定的検証を forward 9,417 レース（必要数 1,000 の 9.4 倍）で再実行し、全月で不合格だった。最後に残った有力仮説（締切直前の資金の動き）も、結果を見る前に基準を固定して検証し、不合格だった。paper-live の BUY は実払戻 ROI 63.4%（175件中3的中）。7月の[利益可能性監査](../profit-feasibility-audit.md)が自分で決めていた撤退条件（6項）を満たした。
2. **8/15〜9/24 の 1,656 コミットは、この判定に何も寄与していない。** 約96%（1,587件）が `fix(research)` で、中身は publication・descriptor・identity・ledger の補強。決定的実験は、forward のサンプルが 1,000件を超えた **7/26 から実行できた**のに、一度も再実行されていない。
3. **その間、唯一大事なデータ収集が止まっていたり不安定だったりした。** private capture は 9/6 に認可が期限切れになり、それから32日間 1件も取れていない。auto-odds は、ノートPCのスリープと fetch にタイムアウトが無いことが原因で、日によってカバー率が 10〜40% まで落ちていた。

## 今回やったこと

- ローカル差分（週次レビューと odds storage report の自動生成物）を stash に退避して `git pull --ff-only` → `main` を `origin/main` と一致させた。
- origin/main に完全にマージ済みのローカルブランチ3本を削除した（`research/catalog-state-reconciliation`、`research/governance-edge-platform`、`research/pre-schedule-readiness`）。
- pull で launchd が実行するコードも変わるため確認した: 依存（lockfile）の変更なし。auto-odds・結果取込・通知スクリプト・`server/` の変更もなし。`src/domain` は研究系と `marketAttention` の入力検証だけ。**本番の収集・判定経路は変わっていない。**
- 判定を再現できるスクリプトを追加した（read-only、出力は stdout だけ）:
  - `scripts/review-20261007-t5-residual-extended.ts`
  - `scripts/review-20261007-late-money.ts`
  - 実行方法: `npx tsx scripts/review-20261007-....ts`（DB を変えるときは `BOAT_PON_DB_URI=...`）

## 数字

### 1. 事前登録の T-5 市場残差検証の延長（6月だけで学習してパラメータを固定し、7/1〜10/7 で forward）

| モデル | forward logloss | Brier | 1位1点 ROI（公式払戻） | 上位2件除外 |
|---|---:|---:|---:|---:|
| T-5 市場 | 3.8014 | 0.9596 | 69.28% | 68.70% |
| 市場 temperature T=0.9 | 3.7907 | 0.9594 | 69.28% | 68.70% |
| 買い目残差（事前登録） | **4.0054（悪化）** | 0.9688 | 73.85% | 73.07% |
| 買い目残差（月次 walk-forward 再学習） | 3.8400（悪化） | – | 76.07% | 75.37% |

- 月別 logloss 差（残差 − 市場）: 7月 +0.229 / 8月 +0.199 / 9月 +0.204 / 10月 +0.166。**全月で市場に負けている。**
- EV ベット（モデル確率 × T-5 オッズ ≥ 閾値、公式払戻で精算）: 閾値を 1.0〜1.5、オッズ上限を ≤100 にしても ROI は 55〜77%。
- 全120通りを均等に買った場合の ROI は 59.4%。
- 本命・大穴の偏り（favourite-longshot bias）は明確にある。オッズ 1〜10倍では実際の的中が市場確率の 1.09倍あるが、それでも ROI は 75.2%。300倍以上は 0.54倍で、ROI 45.7%。
- **T-5 → 確定払戻のドリフト**: 的中した買い目の確定払戻は、T-5 オッズの平均 95.2%（中央値 92.2%）。締切直前に入る資金の方が情報を持っている。T-5 オッズで計算した EV は、最初から 5〜8% 楽観的になる。

### 2. Late money 仮説（2026-10-07 に結果を見る前に事前登録 → 不合格）

- 定義: T-10（無ければ T-20）から T-5 までの市場確率の変化を補正項に入れる。7〜8月で学習し、9/1〜10/7 を forward（3,604 レース）。
- forward logloss は 3.7682 で、市場の 3.7838 を **わずかに上回った（情報は実在する）**。モメンタムの十分位で見ると、実際の的中と期待値の比が 0.47 → 1.13 と単調に増える。
- それでも EV ベットは 136件で ROI 51.9%（上位2件除外では 25.4%）。一番強い十分位を均等買いしても ROI は 59%。
- **判定: REJECT。** 情報はあるが、控除率 25% と直前のドリフトを越える大きさにはまったく届かない。

### 3. paper-live BUY（boatpon-v3-alpha15、2026-07-20〜10-07）

| 月 | BUY | 精算済み | 的中 | 実払戻 ROI |
|---|---:|---:|---:|---:|
| 2026-07 | 27 | 27 | 1 | 103.7% |
| 2026-08 | 74 | 74 | 2 | 112.2% |
| 2026-09 | 61 | 61 | 0 | 0% |
| 2026-10 | 15 | 13 | 0 | 0% |
| 合計 | 177 | 175 | 3 | **63.4%** |

- 的中した3件の確定払戻は、BUY 判定時の表示オッズの 49〜69% しかなかった（例: 表示 56.9倍 → 払戻 2,800円）。「必要オッズを上回った瞬間に BUY する」ルールが、一時的に高くなっているオッズばかりを拾う逆選択になっている。
- 週次レビュー（`docs/rule-candidates.md` に追記されているもの）は毎週「settledBUY: 0」と出していたが、実際には175件が精算済みだった。**レポート側のバグ。**

### 必要な改善幅

最も有利なオッズ帯（1〜10倍）でも、確定払戻ベースの ROI は約75%。損益分岐に届くには、選んだ買い目で市場より **約1.33倍** よく当てる必要がある。実際に観測できた中で最も強い構造的シグナル（late money 上位十分位）でも 1.13倍。公開情報だけを使うモデルで、払戻の上乗せ（リベート）も無い条件でこの差を埋められる根拠は、どのデータにも出ていない。

## 進め方の問題（厳しめに）

1. **目的がすり替わっている。** 守るべきだったのは「edge があるかを最小コストで判定すること」だった。実際には「研究基盤の完全性」が目的になっていた。
   - 1,656コミット中 1,587件が `fix(research)`。件名に harden/bind/descriptor/identity/ledger などを含むものが 822件。
   - テストコード 102,546行に対して本体は 68,765行。`src/research-replay` は 925 ファイルで、`*Boundary.test.ts` だけで 258。npm scripts は 261。docs は 140 ファイル。
   - 象徴的な例が `scripts/analyze-t5-residual-forward.ts`。86行のうち約40行が「レポートを原子的に publish する儀式」で、分析本体は数行しかない。
2. **一番価値のある行動を飛ばした。** 決定的実験はスクリプト1本で2分で終わる。7/26 から実行できたのに、2.5ヶ月間だれも回さなかった。コミット件名の中に、新しい edge の判定を出したものは見当たらない。
3. **「success」が正常の証拠になっていなかった。** N2 rollup は1日3回「success」と出していたが、capture は認可切れで 0件だった。週次レビューは毎週「settledBUY: 0」と出していた。どちらも中身を見れば異常だと分かる。
4. **期限付き認可が時限爆弾になっていた。** 30日で切れる認可（`expiresAt 2026-09-06`）に、更新を促す通知が無かった。しかも capture は `maxRequestsPerDay: 48` の設計で、1日 150〜180 レースに対して最大でも約3割しか取れない。auto-odds とも重複している。
5. **本番インフラがノートPCだった。**
   - バッテリー駆動で蓋を閉じると Clamshell Sleep に入る（`caffeinate -s` は AC 電源のときしか効かない）。
   - `fetch` にタイムアウトが無く、直近2,000回の実行のうち 30回が30分を超えた（最大 2.7時間）。その間 launchd は次の実行を起動しないので、T-5 の窓を丸ごと逃す。
   - launchd はこの作業コピーを直接実行しているので、`git pull` がそのまま本番のコード更新になる。
6. **public リポジトリに self-hosted runner を置いている。** 今のワークフローは `ref: main` を checkout しているので、fork からのコード実行は防がれている。ただ構造としては脆い。
   - `owner-buy-learning-refresh` は `head_repository` を確認しておらず、fork の `main` ブランチからの PR でも Mac 上のジョブが起動しうる。
   - `owner-dashboard-deploy` は fork の head_sha を checkout し、検証より先に `npm ci` を実行する（ubuntu-latest 上、トークンは read-only）。
   - GitHub の公式ガイダンスでは、public リポジトリでの self-hosted runner は非推奨。
7. **指示文とメモが古くなっている。**
   - `CLAUDE.md` の「現在フェーズ（2025-06 時点）」は年が誤っていて、中身も6月の状態のまま。コマンドは `pnpm` と書かれているが、CI は `npm ci`（`pnpm-lock.yaml` の最終更新は 2026-06-02）。
   - エージェント用 memory に「payout_yen はダミー、current_odds で ROI を出す」という廃止済みの指示が残っていた（今回修正済み）。
8. **Git の衛生状態が悪い。**
   - リモートブランチが 2,442本。内訳は PR マージ済み 2,185 / PR なし 168 / 未マージで close 86 / open 1。
   - `delete_branch_on_merge` が無効。
   - GitHub に登録されたワークフローが 130件あり、うち 117件は main に定義ファイルが無い残骸。
   - stash に自動生成物が2件たまっていた。
   - 0バイトの `boat.sqlite` が追跡対象になっている。
   - 週次ジョブが追跡対象の `docs/rule-candidates.md` に追記するので、作業ツリーが毎週汚れる。

## 今の私ならどうするか

**原則: 研究基盤を増築する前に、まず判定を確定させる。そして止める。**

### Phase 0（今日〜今週。どれも明示の承認が必要）

1. 判定を確定記録にする（この文書と、利益可能性監査への追記）。
2. 研究工場を止める。
   - 定期ワークフロー（N2 rollup・readiness）を disable する。GitHub に登録されているワークフローは 130件あり、うち 117件は main にファイルが無い残骸なので、これも disable する。
   - ChatGPT からの dispatch を止める。
   - 認可切れの `com.boatpon.trifecta-private-capture` を unload する（auto-odds と重複している）。
3. self-hosted runner をこの public リポジトリから外す（または、リポジトリを private にする）。
4. 方針を決める。
   - **A. 撤退・アーカイブ**: データは残し、自動化をすべて止める。
   - **B. 趣味の通知アプリとして最小運用**: auto-odds・番組/結果取込・LINE まとめだけを残す。BUY は「娯楽用のシグナル」と明記し、検証の対象からも外す。
   - **C. 最後の1仮説を時間を区切って試す**: T-5 の市場に「まだ入っていない」情報源が具体的にある場合だけ行う。今のところ候補は無い。

   推奨は **A**。続けて楽しみたいなら **B**。C は新しい情報源が見つかるまで着手しない。

### Phase 1（B を選んだ場合の最小修正）

- `scripts/fetch-official-odds.ts` の `fetch` に `signal: AbortSignal.timeout(15_000)` を付ける（ハングで T-5 窓を飛ばすのを防ぐ）。
- 週次レビューの出力先を、追跡されていないパスに移す。「settledBUY: 0」のバグは直すか、ジョブごと止める。
- `CLAUDE.md` を現状に合わせて短く書き直す。

### Phase 2（Git の掃除。リモートへの操作なので承認が必要）

- PR マージ済みのリモートブランチ 2,185本を削除し、`delete_branch_on_merge` を有効にする。
- PR なし 168本と未マージ close 86本は、中身を見てから判断する（`automation/boat-pon-research` は残す）。
- stash 2件を破棄する（内容は自動生成物。パッチの控えあり）。
- `wip-live-validation-preset-20260527`（ローカルだけにある WIP コミット）を残すか消すか決める。
- `boat.sqlite`（0バイト）を追跡対象から外す。npm と pnpm のどちらに統一するか決める。

## 注意点（この判定の限界）

- T-5 の完全市場がそろっているのは番組全体の約47%（9,620 / 20,236）。欠けているのは主にスリープとハングによる時間帯の偏りで、レース結果と関係する欠け方ではないと考えている。ただし、これは確認していない。
- 今回検証したのは3連単だけ。他の券種も控除率は 20〜25% で、過去の検証では拡連複が全条件で最下位だった。
- 選手特徴量などを使う「複雑なモデル × T-5 市場」は今回検証していない。ただ、そうした特徴量を使う v3 モデルは、外部検証（current_odds ROI 0.939、実払戻ならさらに低い）と paper-live（63.4%）の両方で不合格になっている。
- paper-live の n=175 だけでは決定的とは言えない。それでも、ほかの2つの検証と同じ方向を向いている。

## 実施状況（2026-10-08、方針 A = 撤退・アーカイブで実行）

| 項目 | 状態 |
|---|---|
| 判定の記録（この文書・利益監査への追記・lessons-learned） | 済 |
| `CLAUDE.md` と README をアーカイブ状態に更新 | 済 |
| 誤って追跡されていた直下の `boat.sqlite`（0バイト）を追跡から外す | 済 |
| 削除前のバックアップ（全ブランチの bundle と stash パッチ → `backups/git-archive-20261008/`） | 済（`git bundle verify` と clone 後の fsck で確認） |
| launchd ジョブの停止 | **未（ユーザー作業）** — 自動実行の安全判定で拒否されたため。下の「停止の手順」を参照 |
| self-hosted runner の停止・登録解除 | **未（ユーザー作業）** — 同上 |
| GitHub の残りの作業（ワークフロー無効化・ブランチ削除・設定変更・PR #2286 の close） | 下の「GitHub 側の実施結果」に記録 |

### 停止の手順（ユーザーが実行する）

plist は消さない。`disable` は再ログイン後も有効で、`enable` + `bootstrap` で元に戻せる。

```bash
for L in com.boatpon.auto-odds com.boatpon.auto-exhibition com.boatpon.daily-programs com.boatpon.daily-results com.boatpon.daily-notify com.boatpon.daily-progress com.boatpon.weekly-racer-stats com.boatpon.weekly-forward-notify com.boatpon.trifecta-private-capture com.shogo.boat-pon.weekly-review com.boatpon.caffeinate actions.runner.m-shogo-boat-pon.boat-pon-mac-local; do launchctl disable gui/$(id -u)/$L; launchctl bootout gui/$(id -u)/$L; done
```

収集ジョブが動いていない時間帯（21:05〜翌8:00 JST）に実行する。再開するときは、ジョブごとに `launchctl enable gui/$(id -u)/<label>` を実行してから `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist` を実行する。

runner の登録解除は GitHub の Settings → Actions → Runners から行う（`boat-pon-mac-local`）。
