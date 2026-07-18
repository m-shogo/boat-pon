# 期待値モデル改善ロードマップ

## 変わった角度のfeature screen（2026-07-18）

選手間の公開履歴は`pnpm analyze:racer-relationship-market`で、2023年からprior-dayの同走・直接対戦を再構成し、2024→2025のexacta 1-4市場残差へ接続する。師弟は`docs/official-racer-relationships.json`の公式記事で確認できた組だけを記事公開日以後に使う。支部は現在DBにhistorical snapshotがなく、「事務所」に相当する公式構造も確認できないため推測しない。個人名の異常ランキングや不正推測には使わない。

企画番組は主催者が公開している番組設計で、1号艇のみA級、1・4号艇のみA級など明示的な編成が存在する。これは市場が編成構造を過小・過大評価する可能性を調べる正当なfeatureだが、的中率や残差が偏っても「やらせ」の証拠にはならない。現在の旧番組JSONには企画タイトルがないため級別構成proxyに限定し、将来は開催タイトル・企画名をレース前時点で保存してforward検証する。

番組・師弟・イベント・市場・物理環境を単因子の物語にしない検証順序は`docs/integrity-anomaly-research.md`に固定する。利益仮説はT-5市場残差で評価し、公正性の主張とは証拠水準を分離する。

イベント文脈は`pnpm analyze:event-market-context`で、保存済みレース前オッズHTMLから開催タイトルを復元する。競走場の開設周年、BTS等の周年、女子、ルーキー、マスターズ、正月、自治体冠と、年始・GW・お盆・土日の暦を個別カテゴリにし、exacta 1-4の市場残差を2024→2025で比較する。「周年」の一語でG1と企業・場外発売所の冠を混ぜない。

`pnpm analyze:event-selection-matrix`で11文脈×1着1号艇のexacta 5買い目=55セルを横断した。両期n≥30は40セル、両期で市場残差プラスは8セルだったが、最大2的中除外ROIが両期100%以上のセルは0。イベント単独をBUY候補にはしない。最上位だったルーキー・若手×1-4は`pnpm analyze:rookie-event-edge`で4号艇相対能力・A級構成・当地差・機力・登録番号proxyへ分解するが、55セル探索後の説明分析として扱う。

ルーキー・若手×1-4の理由分解では、「4号艇が他の1号艇以外より全国勝率0.5以上上」が2024 n=28・edge +8.36pt・ROI154.6%、2025 n=8・edge +27.74pt・ROI157.5%で最も方向が揃った。ただし2025 n=8、最大2的中除外ROI96.7%で頑健性ゲート未達。4号艇A級、良モーター、新しい登録番号など単純な物語は2025で条件外差が反転または極小となり不採用。現状は「ルーキー開催で4コースに明確な相対能力差がある時」という監視仮説に留める。

開催の盛り上がりは`pnpm analyze:event-stage-market`で、保存HTMLの開催初日、公式race_typeの準優勝戦日・優勝戦日、初日〜5日目以降、ドリーム、進入固定を復元した。10ステージ×exacta 5買い目=50セルのうち両期n≥30は35、両期で市場残差プラスは17セルだったが、最大2的中除外ROIが両期100%以上は0。優勝戦日・開催後半・進入固定という物語だけでは利益edgeにならず不採用。進入固定1-4は2025 ROI154.2%・max2 102.6%でも2024 ROI85.5%・max2 53.8%で、時間レジーム依存として記録する。

当日の人間的なリズムは`pnpm analyze:same-day-rhythm-market`で、現在レースより前の同日勝利、前走着順・ST、走数差、コース移動、同日再戦を再構成した。「4号艇が前走4着以下なら反発」は逆で、exacta 1-4が2024 n=238・edge -1.90pt・ROI33.0%、2025 n=105・edge -1.65pt・ROI73.8%。この条件を外すと全体ROIは77.5→81.8%、96.9→98.7%へ改善するが黒字にはならない。1-2〜1-6への買い替えを13リズム×5買い目=65セルで調べても最大2的中除外ROIが両期100%以上は0。新BUYではなく、将来1-4候補の見送り材料として保留する。

当日の水面ムードは`pnpm analyze:track-mood-market`で、直前までの1コース勝率、外コース勝利、4コース着順・ST、荒配当、Fを11proxy×5買い目=55セルで検証した。両期で残差プラスは26セルでも、最大2的中除外ROIが両期100%以上は0。直前の外枠連勝や「今日は荒れる」という雰囲気だけでは買えない。

人物構成は`pnpm analyze:human-profile-market`で、保存済みレース前HTMLから4,184/4,184レースの支部・年齢・性別・身長・体重・血液型をpoint-in-time復元した。13因子×5買い目=65セルで頑健セルは0。同支部×1-4は2024 edge +1.74pt、2025 +3.44ptだが、血液型一致placebo×1-4が+1.82pt、+2.70ptと同程度以上で、関係性edgeと区別できない。4号艇が10歳以上年上×1-4も2025 ROI143.1%・max2 112.9%に対し2024 ROI90.7%・max2 78.7%。地元支部・年齢・身体差・同支部をBUYへ採用しない。

投票市場の癖は`pnpm analyze:market-microstructure`で、exacta全30通り内の人気順位、1号艇への確率mass、有効選択肢数、隣接2着艇との相対価格を11因子×5買い目=55セルで検証した。厳密な完全市場4,161レースを評価し、両期で残差プラスは22セルでも最大2的中除外ROIが両期100%以上は0。人気3位以内1-4は2024 ROI87.9%・2025 ROI89.0%、隣接より25%以上売れ過ぎの1-4も81.9%・85.8%で、正の残差は控除を超えない。無意味な整数オッズplacebo×1-4が2025 ROI184.3%と最も派手になったため、価格末尾や局所形状の後付け探索をedgeとして採用しない。

投票者の注意分散は`pnpm analyze:market-attention`で、公式番組の締切予定時刻から他場との前後2分・5分衝突、同一R集中、同日開催負荷、孤立時間を11因子×5買い目=55セルで検証した。parserの会場切替誤認を避け、同一場1〜12R完備かつ時刻単調増加のvenue-dayだけを使った。孤立10分以上×1-4は2024 ROI104.2%・2025 ROI111.0%だが、最大2的中除外で62.0%・78.7%。さらに会場×R番号×暦月を揃えると1-4候補は両期プラスを維持しない。唯一残った混雑×1-6も2024のleave-one会場最小deltaが-1.27ptへ反転した。時間帯・場・番組構成の交絡と配当集中として不採用。

投票者の資金・心理周期は`pnpm analyze:bettor-calendar`で、24〜26日、月初・月末、五十日、曜日、6月・12月を日付proxyとして11因子×5買い目=55セルで検証した。会場×R番号×同月または同四半期を揃えると、土日1-4など5セルは両期deltaとleave-one会場がプラス。ただし土日1-4の最大2的中除外ROIは2024 73.5%・2025 104.9%で、全55セルの頑健利益は0。7・17・27日placeboの1-4や11・22日placeboの1-3も両期残差プラスになり、実売上・参加者数なしで給与日や曜日を利益因果としない。

局所的な異常理由は`pnpm analyze:local-market-anomalies`で、丸亀・大村・常滑のexacta 1-2と風速2〜3mの1-4を、2024発見→2025 forward、選手能力差・当地差・機力・展示・相手構成に分解する。historical closing oddsなので仮説生成専用とし、T-5で再現するまで採用しない。

最有力の新規監視仮説は「風速2〜3m・南西風・4号艇が1号艇以外で全国勝率最上位 → exacta 1-4」。2024はn=52、13hit、edge +8.44pt、最大2件除外ROI 132.8%、2025はn=24、10hit、edge +22.66pt、最大2件除外ROI 139.5%。ただし2024はびわこまたは2024-05をleave-one-outすると最大2件除外ROIが100%を割り、2025も標本が24件しかない。過去風向は結果取得系`race_conditions`由来で、live締切前`race_weather`には未保存。post-hoc・point-in-time非同等・小標本のためproduction接続せず、将来T-5で条件固定監視する。

理由は単因子に固定しない。組合せセルとexact matchingでは、4号艇最強単独・全天候は両期ROI100%未満、南西風以外の風2〜3mでは2025 edgeが負。一方、会場・季節を揃えた南西風環境の市場残差差は2024 +8.49pt、2025 +27.08pt。現段階は「南西風環境が主軸、4号艇相対能力が相互作用、会場・季節・開催単位の配当集中が交絡」という多因子仮説とする。能力効果は細かいmatchingでcoverageが落ち差も消えるため独立原因とは断定しない。

探索多重度監査では、1-4の風速5帯×風向9種×4号艇最強/非最強のうち2024 n≥30は32セル。対象セルはz順位3位、raw p≈0.068、family-wise p≈0.814で、探索後の統計的異常とは言えない。一方、後付けの頑健性ゲート（n≥30、z≥1.5、最大2件除外ROI≥100%）を2024だけへ適用すると対象1セルだけが残り、同じ固定条件は2025でも再現した。ゲート自体が後付けなので証明とは扱わず、次のfuture-only期間へ事前固定する。

このfamily-wise補正は1-4の風×能力32セルだけで、先行した買い目・会場・展示探索を含まないため実際の多重度はさらに大きい。exacta odds自体は取得可能性監査の18/18サンプルでF返還を除き払戻/100と一致しており、単純なパース不良は主因ではなさそう。ただし全件検算ではなく、風向は結果取得系なのでT-5時点同等ではない。

`pnpm analyze:unconventional-features`で103,490レースを2024→2025に固定分割し、当時の出走表と過去日までの同走・移動・F履歴だけを使って1号艇1着率をscreenした。これは利益edgeではなく、T-5市場残差モデルへ渡す仮説候補である。

- 両年で同方向: 能力断層、単独上位級、選手とモーターの食い違い、短期会場移動、前走勝利、2号艇との過去対戦、顔なじみ、外枠最強、当地苦手
- F後180日、雪辱戦、相手にF後が複数は両年で強い一貫性なし
- 短期会場移動のプラスは強い選手ほど遠征する交絡の可能性があり、因果効果とは扱わない
- 誕生日は公式選手profileに存在するがDB未保存。周年・イベントは2024-2025旧番組JSONにタイトル未保存のためforward専用
- 私的人間関係や噂は使わず、過去同走回数・直接対戦だけを再現可能な代理変数にする

単独勝率で不採用だった結果も、edge仮説の保留台帳として保持する。F後180日、雪辱戦、相手にF後が複数、当地覚醒は、今回の定義だけでは1号艇勝率上昇のBUY根拠にしない。ただし勝率低下も市場の織り込み不足があれば逆方向の利益edgeになり得るため、永久棄却しない。「物語として自然」「着順予測に効く」「市場控除後に再現するedge」を分け、T-5市場残差と買い目別相互作用で再評価する。詳細は`reports/unconventional-feature-screen.md`の保留台帳に残す。

これらをBUY条件へ直接追加しない。T-5全市場coverageとsettled gateを満たした後、市場確率を超えて説明力が残るかだけを確認する。

## 2026-07-18 shadow top-1再評価

買い目別オッズの結合不整合をproductionへ接続せず再現し、正しい`race_id/selection`オッズ、
日付以前180日だけの学習、1レース1候補、公式払戻ROIで2024年・2025年を再評価した。

| shadow戦略 | 2024 n / ROI | 2025 n / ROI | 判定 |
|---|---:|---:|---|
| model score top-1 + 現行判定 | 2 / 0% | 1 / 0% | BUYがほぼ消える |
| max model EV、EV≥1.00、odds≤100 | 3,215 / 82.3% | 2,329 / 58.0% | 黒字なし |
| max model EV、EV≥1.25、odds≤100 | 1,897 / 69.3% | 1,441 / 45.1% | 閾値上昇で悪化 |
| max model EV、EV≥1.50、odds≤100 | 1,091 / 74.2% | 871 / 38.6% | 過信・逆選択 |

2025年のEV≥1.00は最大2hit除外ROI 51.3%、最大連敗488。2024年も最大2hit除外ROI 76.8%。
現行の`estimatedHitRate × odds`は市場の誤りを示さず、高EV表示ほど過信が強い。

次の研究軸は、着順確率そのものではなく、T-5時点の全120通りオッズを正規化した市場確率と
実着順の残差を予測するモデルにする。締切後/latest oddsだけの改善は採用せず、future-only T-5で
CLV、公式払戻ROI、最大2hit除外ROIを通過するまでproductionへ接続しない。

### T-5市場残差screening（2026-06-01〜2026-07-17）

`odds_timeseries_snapshots`のT-5全120通りが揃った342レースを抽出し、結果確定272レースで比較した。

| 確率構成 | settled n | 的中 | 公式払戻ROI |
|---|---:|---:|---:|
| 市場確率のみ | 272 | 8 | 72.9% |
| 市場90% + 現行モデル10% | 272 | 0 | 0% |
| 市場75% + 現行モデル25% | 272 | 0 | 0% |
| 市場50% + 現行モデル50% | 272 | 0 | 0% |
| 現行モデルのみ | 272 | 0 | 0% |

市場のみの72.9%は控除後の期待水準と整合する。一方、現行モデルは10%混合でも極端な外れ目を
選び、残差信号として有害だった。現行`estimatedHitRate`の単純blendは終了する。

市場残差モデルの着手ゲート:

- T-5全120通り + 結果確定が最低1,000レース
- 学習対象は`実着順 - T-5正規化市場確率`。現行確率の単純混合は禁止
- 時系列splitを固定し、holdoutを探索へ戻さない
- 市場のみbaseline、最大2hit除外ROI、CLV、最大DDを必ず併記
- 公式払戻ROIが100%を超えてもfuture-only再確認までproduction未接続

最終更新: 2026-07-18 (買い目別オッズ + shadow top-1再評価)

Boat Pon は自動購入アプリではない。目的は、ほとんどの日を見送り、数字的に割に合う可能性がある時だけ公式確認へ進むこと。

失敗・学びの蓄積は `docs/lessons-learned.md` に残す。重い作業の前には、このロードマップと失敗ログを確認する。

## 現在入っているもの

- プロペラ制度レジーム分離
  - 2012-05-01以降を現代モデルの主対象にする
  - 2012年4月の移行期は現代予測から外す
- 会場別/艇番別の観測頻度モデル
- Laplaceスムージング
- 番組カテゴリ推定
  - SG, PG1, G1, G2, G3, 一般, 女子, ルーキー, 匠, 進入固定, 優勝戦, 準優勝戦, 企画
- 番組表特徴量による保守的補正
  - 1着艇の級別、全国勝率、当地勝率、モーター2率、ボート2率
- 月次ドリフト監視
- モデル比較API/UI
- オッズ履歴保存テーブル
- 信頼下限スコアによる会場内トップ買い目選択
  - `estimatedHitRate` の平均値最大ではなく、hit数と母数から計算した信頼下限を `selectionScore` として使う
  - 候補の実判定に使う的中率も `conservativeHitRate` に落とす
  - 目的: 120通りの中から過去最大を選ぶ cherry-picking バイアスを、alpha調整とは別の層で抑える

## 現行モデル

- **model_version: boatpon-v3-alpha15**（2026-05-26 v4検証後に v3 で確定）
- DEFAULT_MODEL_ALPHA=15、Laplace平滑化 alpha=15
- 現行フィルター設定（app_settings.budget_rule）:
  - `allowedClassNames`: ["B1"]
  - `minRequiredOdds`: 25
  - `maxOddsRatio`: 2.0（全体上限）
  - `classOddsRatioRules`: B1 → maxOddsRatio=1.5
  - `excludedVenues`: 戸田・多摩川・桐生・三国・江戸川（5会場）
  - `excludedRaceNos`: [11, 12]
  - `minFirstBoatNationalWinRate`: 4.0
  - `excludeSameClassSecondBoat`: false（外部検証で否定済み）
- 外部検証到達点（2020-2023データ、pseudo-BUY基準）:
  - ROI=0.939（ランダムベット 0.74 より改善、breakeven 1.0 には届かず）
  - これ以上のパラメータ調整では改善不可と確認（cherry-picking+逆選択は構造的問題）
- ❌ **v4-conservative は 2026-05-26 外部検証で不採用**:
  - 保守化により必要オッズが約17%上昇 → BUY数 86%減 → ROI悪化（2025: 0.788、2024: 0.302）
  - 外部(2020-2023): v3 ROI=0.720 vs v4 ROI=0.720（BUY数1/3でほぼ同等→得なし）
  - 根本原因: 閾値を上げると逆選択が強まる。保守化は構造的問題の解決にならない

## 2026-05-24 の分析結果サマリー（セッション3最終版）

### v3-alpha15 モデルの実績（2025年全期間、BUY n=2,088）

| オッズ帯 | n | 的中 | ROI | 推定的中率 | 実測的中率 | 過大倍率 |
|---------|---|------|-----|-----------|-----------|---------|
| 20〜30倍 | 168 | 7 | 1.097 | 4.99% | 4.17% | 1.2x ← 良好 |
| 30〜50倍 | 1,288 | 25 | 0.754 | 4.10% | 1.94% | 2.1x ← 問題 |
| 50〜100倍 | 631 | 10 | 0.920 | 3.36% | 1.58% | 2.1x ← 問題 |
| **全体** | **2,088** | **42** | **0.835** | | | |

**alpha=15 の効果**: alpha=1 時代（v2: 全帯 3.7倍過大推定）から 20-30倍帯はほぼ解消。30倍以上はまだ2倍の過大推定が残る。

### 試みたフィルターの月別評価（n不足で採用不可）

以下はすべてバックテスト内での最適化であり、月次 n=30〜130 では分散が大きすぎて統計的有意差がない:

| フィルター | n | ROI | 月別 0.0 月数 | 判定 |
|-----------|---|-----|--------------|------|
| 全BUY | 2,088 | 0.835 | 3/11 | 現状 |
| 30-50倍除外 | 800 | 0.964 | 2/11 | 過学習リスク |
| ratio1.5-2.0x | 649 | 0.840 | 5/11 | 採用不可 |
| 可変blendWeight | 353 | ~1.05 | 4/11 | 採用不可 |

### v3時点の実装（参照用）

- **app_settings: maxOddsRatio=2.0**（ratio>2.0のBUYを除外）
- **model_version: boatpon-v3-alpha15**（DEFAULT_MODEL_ALPHA=15）
- **BudgetRule**: maxOdds, maxOddsRatio, minOddsRatio, marketBlendWeight フィールド実装済み（未設定）
- **BudgetRule**: calibrationMode, calibrationBasis, oddsCalibrationFactors 実装済み（デフォルトnone、v3-empiricalで必要オッズ帯または取得オッズ帯別補正）
- **BudgetRule**: programFilter 実装済み（1着候補艇の級別、モーター2連率、ボート2連率でBUY対象を絞れる）
- **BudgetRule**: minRequiredOdds=25 設定済み（外部検証でreq>=30は逆効果確認、req>=25を維持）
- **BudgetRule**: excludedVenues 設定済み（戸田・多摩川・桐生・三国・江戸川の5会場除外、外部検証済み）
- **BudgetRule**: classOddsRatioRules 設定済み（B1 maxOddsRatio=1.5。A2は外部検証ROI=0.63で不採用）
- **programFilter**: allowedClassNames=["B1"]・excludeSameClassSecondBoat=false・minFirstBoatNationalWinRate=4.0 設定済み
- ✅ Calibration分析UI追加（/api/backtest/calibration + CalibrationPanel: req帯×クラス別 calib_ratio）
- ✅ 新規DB/設定未保存時の初期設定も現行の安全フィルター付き `DEFAULT_APP_RULE` に統一

### 根本課題

30-50倍帯の主な構成は 1-2-3 selection（n=1,243/1,288）。この帯の実測的中率 2.01% に対してモデル推定 4.13%。原因はチェリーピッキングバイアス（会場ごとに最良セレクションを選ぶ際に期待値が過大になる）がまだ alpha=15 でも 30 倍超では残ること。根本修正には 2024 年以前のデータ拡充が必要。

### 旧セッション2の記録（参照用）

以下は v2モデル時代（alpha=1）の数字:
- BUY: 684件, 的中12件（1.75%）, ROI 0.511
- 全帯 calibration 3.7倍過大推定

## 次にデータ待ちのもの

- 過去オッズ補完
  - ✅ 2025年全月 odds_snapshots 17,123件（セッション3完了時点）
  - ✅ 2025-01〜11 の decision_history（v3-alpha15）: BUY 2,443件、WATCH 1,420件、SKIP 23,839件（再生成済み）
  - ✅ 2024-01〜12 の decision_history（v3-alpha15）: BUY 3,957件、WATCH 1,947件、SKIP 49,795件（再生成済み）
  - ✅ BUY/WATCH はオッズ取得率ほぼ100%
  - ✅ kyotei24パーサー: 欠場レースの異常オッズ(MAX_VALID_ODDS=1000)修正済み
  - ✅ marketBlendWeight 実装済み（BudgetRule、デフォルト0）
  - ✅ maxOddsRatio=2.0 を app_settings に設定済み（ライブ適用中）
  - ✅ programFilter (A2×motor<40%) 実装済みだが実測ROI悪化のため不採用（DB設定なし）
  - ✅ バックフィル完了: 2022全年・2023全年 odds_snapshots（2020/2021はkyotei24に7月以前データなし、限界）
  - ✅ 2022/2023外部検証完了（セッション9): B1(ratio<1.5) 外部合算ROI=0.739（ランダムベット水準）、A2(ratio>=1.5) ROI=0.630
  - ✅ A2をallowedClassNamesから除外済み（外部検証 ROI=0.63で閾値0.70未満）
  - ✅ Calibration API/UI追加（/api/backtest/calibration）: req帯×クラス別 calib_ratio 表示
  - ✅ daily-brushupにbuyModelVersionDrift・decisionRuleGrid追加
  - ✅ calibration バイアス探索完了（セッション12）: パラメータ調整では改善不可と確認
    - alpha増加・ratio絞り込み・marketBlendWeight いずれも外部ROI悪化
    - 原因: cherry-picking バイアス＋逆選択は構造的問題でパラメータ非依存
    - 現モデル到達点: 外部ROI=0.939（ランダム0.74より改善、breakeven未満）
  - B1外部検証結果: 真のROI≒0.94（ランダムより改善、edge候補だが未確定）、ライブ継続は最小額/paper扱い
  - 注意: programFilter 等の設定変更評価は --refresh-existing ではなく DELETE + 再生成で行う
  - **セッション4発見: B1+25-30帯フィルターが両年ROI>1.17（全件1-2-3・B1の1号艇・市場がB1を過小評価）**
  - **セッション4発見: 難水面5会場（戸田・多摩川・桐生・三国・江戸川）が系統的にROI<0.5**
  - **セッション5発見: odds_ratio≥1.7はB1+25-30帯内でも系統的に悪い（188件で1的中・0.53% 実測 vs 4.5% 推定）。全BUYでも1.7-2.0x帯ROI=0.672。市場が大幅に高オッズを付けるとき、市場が正しい傾向**
  - **セッション5発見: B1+25-30+ratio<1.7+三国除外の組合せは2024=1.454, 2025=1.504でhit率4.13%両年一致。ただし3層最適化のため2023年外部検証前に採用不可**
  - **セッション5追加発見(重要): 2号艇クラス≠1号艇クラスが全req_odds帯で一貫してROI改善。B1全帯+2号艇≠B1: 2024=1.194, 2025=1.081。B1+25-30+2号艇≠B1: 2024=1.406, 2025=1.643。全帯で「2号艇≠B1」が「2号艇=B1」を上回るため、req_odds帯に依存しない汎用シグナル**
  - **実装済み: programFilter.excludedSecondBoatClassNames, BetCandidate.secondBoatFeature/thirdBoatFeature**
  - **セッション5最終: 月別安定性検証完了。B1全帯+2号艇≠B1 がゼロ月率8.7%(1/23月)で最安定。B1+25-30は12.5%(2/16月)。B1+25-30+2号≠B1は26.7%(4/15月)でROI高いが月別不安定**
  - **3号艇クラス追加フィルターは不採用: A2除外でROI+0.054のみ・3層最適化リスク大**
  - **外部検証優先度: (1)B1全帯+2号艇≠B1 → (2)B1+25-30 → (3)B1+25-30+2号≠B1 の順**
  - **セッション6発見: B1全帯+2号艇≠B1内でも難水面5会場は330件2的中(ROI=0.314)。多摩川・戸田・江戸川は完全0的中。5会場除外後: 2024=1.401(n=703), 2025=1.323(n=444)。両条件独立した理論根拠あり → 外部検証第一候補**
  - **❌ セッション12: 2号艇≠B1 外部検証(2020-2023)で否定 → 撤回済み（2026-05-26）**
    - 外部 ROI: 2号艇≠B1=0.786 vs 2号艇=B1=1.063 vs 全体=0.944（方向逆転）
    - 2024-2025の高ROIは年22件以下の少数ヒットの偶然と判定
    - `excludeSameClassSecondBoat=false` に変更済み
    - B1フィルター本体（5会場除外+req>=25+ratio<1.5）は外部ROI=0.944で有効 → 維持
  - **❌ セッション12: A2クラス追加 外部検証で否定 → 不採用（2026-05-26）**
    - in-sample(2024-2025): B1+A2+異クラス ROI=1.2前後（月次安定）
    - 外部(2020-2023): A2合計 ROI=0.663、全年で B1(0.937)に負け
    - A2(ratio>=1.5)特化でも ROI=0.725 → B1単独より悪い
    - `allowedClassNames` は ["B1"] のまま維持
  - **❌ セッション12: 土曜除外 外部検証で否定 → 不採用（2026-05-26）**
    - in-sample(2024-2025): 土曜 n=108, ROI=0.0（2年0的中）
    - 外部(2020-2023): 土曜 n=1,790, ROI=0.866（2022=1.074, 2023=0.992 と逆転）
    - 2号艇≠B1と同一のパターン。多重検定（7曜日）補正後は偶然の範囲
    - `excludedDaysOfWeek` は実装しない
  - **✅ セッション12: 会場別ROI外部検証完了 → 追加除外なし（2026-05-26）**
    - 唐津(ROI=0.433), 津(0.505), 浜名湖(0.636) がワーストだが年別一貫性なし
    - 唐津2023=1.054, 浜名湖2021=1.022 と逆転する年あり
    - 追加除外時: ROI 0.818→0.875（n 17%減）だが全体 ROI<1.0 のまま
    - 外部データの多重検定リスクも考慮し現状5会場除外を維持
    - 現在の外部検証到達点（B1+req>=25+ratio<1.5+5会場除外）: ROI=0.818
- 天候/風波/安定板/周回短縮の実データ紐づけ
- 返還/欠場/展示異常のBUY抑制
- 番組カテゴリ別に targetEv/minSampleSize を変える検証
- **優先度高: 2024年データで calibration 検証を拡充する**（月次 n が少なすぎてフィルター効果が判断不能）

## 採用ルール

- ROIだけで採用しない
- BUY数が少なすぎる条件は過学習扱い
- 月別ROIが極端にブレる条件は保留
- オッズ未取得のBUYは採用しない
- 「買わない日が増える」改善は成功として扱う
- 採用/保留/却下の判断は `docs/lessons-learned.md` の採用判定テンプレで記録する

## 進め方

1. 小さい期間で仮説を作る。
2. 先にデータ整合性、ROI定義、重複行、旧モデル混入を直す。
3. 重い取得や全期間再生成は、その後に実行する。
4. 条件探索は、探索した期間と検証する期間を分ける。
5. 採用判断は、総ROI、月別、会場別、オッズ帯別、BUY数をセットで見る。

## 重い作業前に必ず確認すること

- `git status --short` で未コミット差分を確認する。
- `data/boat.sqlite` への書き込みを並行実行しない。
- `fetch:official-results`, `fetch:official-programs`, `fetch:kyotei24` は明示承認なしに実行しない。
- `data/raw/official` は触らない。
- ROIは `payout_yen` ではなく `current_odds` ベースで確認する。
- `generate:history` 後は同一 `race_id` 重複と旧モデルBUYの残りを確認する。

## 2026 ライブ監視フレーム（固定しきい値）

2026-01-01以降の現行 `MODEL_VERSION` BUYを「完全未使用データ」として外部検証と分離して蓄積する。

### 現在の状態（2026-05-26）

- **モード: paper live観察モード（実購入なし）**
- 2026年 v3-alpha15 live BUY: **n=0**（蓄積中、購入は行わない）
- 通知は `[paper] BUY候補` として発火するが、実購入の根拠にしない
- 判定・オッズ取得・decision_history・結果記録は継続
- 理由: 外部検証 ROI=0.939 < 1.0。edge未確認の状態で実購入は行わない

### 次回見直し予定

- **2027-05-26（1年後）**: live BUY数・ROI・roiExMax を確認し、再検討条件を満たすか判断する
- 再検討条件: live n>=300 かつ ROI>1.05 かつ roiExMax>1.0
- 条件を満たさなければさらに継続。満たせばその時点で購入を検討する

### 再検討条件（この条件を満たすまで購入しない）

| 条件 | しきい値 |
|------|---------|
| live BUY n | >= 300 |
| live ROI | > 1.05 |
| roiExMax（最大払戻除外ROI） | > 1.0 が望ましい |

- **n < 300 の間は ROI がどうであっても購入判断しない**
- 3連単の分散が大きすぎるため、n=300 未満は「誤差の範囲」として扱う
- 上記3条件を同時に満たしたら、そこで改めて検討を開始する

### 観察ログの設計（重要）

ライブ決定と generate:history はどちらも `source="history-model"` になり得るため、`decision_history.run_kind` で区別する。
2026年live監視の条件: 現行 `MODEL_VERSION` かつ `date>=2026-01-01` かつ `run_kind='paper-live'`

自動除外されるもの:
- 旧モデル: `model_version=boatpon-v2-regime-category` 等 → 除外
- sampleデータ: `model_version=null`（プログラムデータなし時のフォールバック）→ 除外
- historical-backfill / manual-test: `run_kind!='paper-live'` → 除外

除外されない汚染リスク:
- `--allow-live-write` で generate:history を2026年対象に意図的実行した場合 → `run_kind='historical-backfill'` として記録し、live集計からは除外する

診断: LiveMonitorPanel の「診断: 2026年BUY全件内訳」で除外対象を確認できる。  
CLI確認: `npm run monitor:live` でサーバー起動なしに同じ監視サマリーを読み取り専用で確認できる。

### live記録の設計（重要）

ライブ決定と generate:history はどちらも `source="history-model"` になり得るため、`decision_history.run_kind` で区別する。
2026年live監視の条件: 現行 `MODEL_VERSION` かつ `date>=2026-01-01` かつ `run_kind='paper-live'`

自動除外されるもの:
- 旧モデル: `model_version=boatpon-v2-regime-category` 等 → 除外
- sampleデータ: `model_version=null`（プログラムデータなし時のフォールバック）→ 除外
- historical-backfill / manual-test: `run_kind!='paper-live'` → 除外

除外されない汚染リスク:
- `--allow-live-write` で generate:history を2026年対象に意図的実行した場合 → `run_kind='historical-backfill'` として記録し、live集計からは除外する

診断: LiveMonitorPanel の「診断: 2026年BUY全件内訳」で除外対象を確認できる。
CLI確認: `npm run monitor:live` でサーバー起動なしに同じ監視サマリーを読み取り専用で確認できる。

蓄積経路:
- `/api/dashboard` が `buildCandidateRows` の各候補に対して `insertDecisionHistory` を呼ぶ。
- `buildCandidatesFromModel` 由来の候補は `source="history-model"` と現行 `model_version` を持つ。
- `npm run monitor:live` の `latestModelDecision` が空なら、2026年の現行モデル実運用判定履歴がまだ保存されていない。
- `latestModelDecision` がありBUYだけ0なら、保存経路は動いているがBUY条件未達と見る。

### 注意: generate:history を 2026年対象で実行しない

generate:historyで2026年の decision_history を生成すると監視データが汚染される。  
2026年の generate:history 実行は明示承認なしに行わない。

#### ガード仕様（scripts/generate-decision-history.ts 実装済み）

`--to` が `2026-01-01` 以降を含む場合、`--allow-live-write` フラグなしでは exit(1) で停止する。

```
# 停止される（ガード発動）
npm run generate:history -- --from 2026-05-01 --to 2026-05-21 --limit 100

# 許可される（dry-runはガード対象外）
npm run generate:history -- --from 2026-05-01 --to 2026-05-21 --limit 100 --dry-run

# 意図的に実行する場合のみ（通常使用禁止・事前承認必須）
npm run generate:history -- --from YYYY-MM-DD --to YYYY-MM-DD --limit N --allow-live-write
```

## 見るべき画面

1. Backtest > モデル比較
2. Backtest > 2026ライブ監視
3. Backtest > Calibration分析（外部/in-sample比較）
4. Dashboard > モデル監視
5. Dashboard > 番組カテゴリ別ROI
6. Dashboard > 会場別ROIヒートマップ
7. Backtest > 時系列検証

## 判定履歴の増やし方

外部取得なしで、保存済みの公式番組表と結果からウォークフォワード判定履歴を作れる。
補完対象を増やす時は、まず短い期間・少ない件数で dry-run する。

```bash
npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-21 --limit 100
npm run generate:history -- --dry-run --from 2026-05-01 --to 2026-05-21 --limit 100 --include-required-odds-candidates
npm run generate:history -- --from 2025-05-01 --to 2025-05-21 --limit 100
npm run generate:history -- --from 2025-05-01 --to 2025-05-21 --limit 100 --refresh-existing --include-skips
```

- `--from`, `--to`, `--limit` は必須。
- 書き込み実行は2025年以前だけにする。2026年以降は dry-run 以外で対象にしない。
- 学習期間はデフォルトで対象開始日の180日前から。変える場合は `--train-days 365` のように指定する。
- デフォルトでは BUY/WATCH のみ保存し、SKIPは保存しない。
- `--include-skips` を付けた時だけSKIPも保存する。
- `--include-required-odds-candidates` を付けると、オッズ未取得でも必要オッズ80倍以下の候補を保存対象にできる。
- 同じ期間を再実行しても、同じ `raceId + selection` の履歴は重複保存しない。
- `--refresh-existing` を付けると、補完済みオッズを使って既存履歴の `currentOdds / EV / decision` を再計算する。
- 外部サイトにはアクセスしない。
