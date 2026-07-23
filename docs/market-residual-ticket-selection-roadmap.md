# 市場残差・全券種選択ロードマップ

更新: 2026-07-23

## 位置づけと安全境界

本ロードマップは市場モデルの詳細正本である。N0後の全体順序、研究アイデア、評価系列分離は[`research-platform-master-plan.md`](research-platform-master-plan.md)を最上位正本とする。今回は文書化だけを行い、モデル実装、DB migration、収集追加、本番接続は行わない。

- 現行BUY/WATCH/SKIP条件を変更しない。
- 自動購入は行わない。
- 最初に行うのは予測変更ではなく、データ取得可能性と保存設計の監査である。
- データ収集基盤の実装は、現在フェーズを検証・commit・pushして閉じた後の別タスクから開始できる。
- 残差モデル学習は、T-5全市場と正式結果について既存の最低1,000 settled gateを満たすまで開始しない。
- production判定への接続は、固定条件のfuture-only検証を通過するまで禁止する。

現行formal settled固定条件蓄積は継続する。新研究側の順序は`Stage 0 → F0 → F0-R → N1 → D1 → N2 → N3 → N4 → D2 → E1 → E2 → N5 → N6 → N7 → N8`で固定し、次の独立タスクはF0のtemp/sidecar vertical sliceである。

現行benchmarkは`decision_system=legacy_t5_formal`、`strategy_version=legacy-t5-v1`、`evaluation_mode=formal_forward`。これはfixed enrollment protocolのprospective cohortであり、報告時にfrozen analysis snapshotを作る。新方式は`decision_system=market_intelligence`、versioned strategy、`evaluation_mode=shadow_forward`、versioned enrollment/snapshotとする。

## 中核仮説

市場は「どの艇が強いか」という公開能力情報をかなり織り込んでいる可能性が高い。一方で、「どの順位まで確実か」「順序まで確実か」「その不確実性をどの券種で表現するべきか」「異なる券種間で価格が整合しているか」には、検証余地が残る。

目的は必勝法の発見ではない。

- 市場確率を無視した独自予想を作らない。
- 市場が誤っている部分だけを残差として検出する。
- 3連単に固定せず、予測可能な順位の深さに応じて券種を選ぶ。
- 保守的期待値が正でなければSKIPする。
- 予測精度と収益edgeを分離して評価する。

## 共通状態空間

全6艇の720完全順位ではなく、舟券に必要な上位3着の順序付き全120通りを共通状態空間にする。

理由:

- 主要券種の確率を同じ120通りから整合的に導出できる。
- 4〜6着という不要な学習ノイズを避けられる。
- 券種ごとに矛盾した確率を作らずに済む。
- 720通りより標本効率が良い。
- 3連単市場を自然なbaselineとして利用できる。

`P(a,b,c)`を、相異なる艇`a,b,c`が順に1〜3着となる確率とする。全120通りについて`P(a,b,c) ≥ 0`かつ`ΣP(a,b,c) = 1`を要求し、各券種へ次のように集約する。

- 単勝`a`: `Σ_{b,c} P(a,b,c)`
- 複勝`a`: 対象レースの公式的中条件に従い、`a`が対象着位内に入る全状態の和
- 2連単`a-b`: `Σ_c P(a,b,c)`
- 2連複`a=b`: `Σ_c [P(a,b,c) + P(b,a,c)]`
- 3連単`a-b-c`: `P(a,b,c)`
- 3連複`{a,b,c}`: 3艇の全6順列の和
- 拡連複`a=b`: `a,b`がともに3着以内に入る全状態の和

複勝・拡連複は同着や発売条件を含む公式ルールをPhase N0で確定し、推測で定義しない。実装時は単体テストで、120通りの総和1.0、各券種への集約値、排反な全買い目集合の総和を保証する。

## 市場offset残差モデル

独自モデル確率と市場確率の単純blendは使わず、T-5市場確率をoffsetとして残差だけを学習する。

`corrected probability ∝ market probability × exp(residual adjustment)`

- residual adjustmentが0なら市場確率と完全一致する。
- 現在の事前校正でα=0が選ばれた結果と整合する初期状態にする。
- 残差は強く正則化し、0へ縮小する。
- 市場から離れるにはfuture-onlyデータで明確な根拠を要求する。
- 市場のみのM0 baselineを常に残す。
- 現行`estimatedHitRate`との単純blendを復活させない。
- 候補特徴量を単独でBUY条件へ追加せず、市場残差への追加説明力だけを評価する。

## レース展開と相互作用

全国勝率、当地勝率、モーター順位を単独で並べるだけでなく、1マーク展開の相互作用を条件付き順位分布として扱う。

候補状態:

- 逃げ安定
- 差し圧力
- まくり圧力
- まくり差し
- 進入変化
- 混戦
- 事故・不確実性増大

強い艇の単独評価だけでなく、攻め艇が隣艇を潰す可能性、攻めに連動して外艇が上がる可能性、1号艇が1着を守っても2・3着分布が崩れる可能性、上位3艇の顔ぶれは合っていても順序が不安定なケースを扱う。個別能力より条件付き順位分布を重視する。

展開ラベルを結果を見た人間の主観で後付けしない。レース前に取得可能な再現可能特徴量と公式結果データから、定義・生成時刻・欠損処理を固定して作る。

## 予測可能な順位の深さと券種選択

各レースで次を別々に評価する。

- 1着の確実性
- 上位2艇集合の確実性
- 上位2艇順序の確実性
- 上位3艇集合の確実性
- 上位3艇順序の確実性

候補対応:

- 1着だけ読める: 単勝
- 1艇が2着以内に強い: 複勝
- 上位2艇は読めるが順番不明: 2連複
- 1・2着順まで読める: 2連単
- 上位3艇は読めるが順番不明: 3連複
- 1〜3着順まで読める: 3連単
- 1着から不安定: SKIP

これは「的中率が高い券種を選ぶ」規則ではない。各券種の価格、確定価格の不確実性、モデル不確実性、探索罰則を含む保守的期待値で比較する。

## 全券種を別市場センサーとして扱う

券種は別々の投票プールなので、同じ市場確率の単なる別表現として扱わない。

確認対象:

- 券種ごとの控除構造と流動性
- オッズ更新頻度と変化の粗さ
- 人気順位変化
- 関連買い目への価格変動の波及
- 単一買い目だけが動いたか
- 複数券種が同じレース解釈を示したか

例えば4号艇評価が本物なら、単勝4、複勝4、2連単・2連複・3連単・3連複の関連買い目が整合して動く可能性がある。一つの薄い3連単買い目だけが急落した場合は、情報資金ではなく流動性ノイズの可能性を考慮する。

券種間の不一致を即BUY根拠にせず、先に市場品質、流動性、データ品質を確認する。

## 確定オッズ分布

T-5表示オッズを確定値とせず、T-5から締切までの変化分布を予測する。候補checkpointはT-30、T-20、T-10、T-5、T-3、T-1、final-likeまたは公式払戻相当値とする。

予測対象:

- 確定オッズの平均と分布
- 下落リスク
- 変化速度と加速度
- 一度下がって戻ったか、継続して下がったか
- 人気順位の入れ替わり
- 関連買い目への波及率

買い判定には平均確定オッズではなく、保守的な下側分位点を使う。final-likeと公式確定値の意味は分離し、取得不能な確定オッズを払戻から推測しない。

## 保守的券種選択スコア

概念式:

`decision score = conservative EV lower bound - model uncertainty - odds uncertainty - search penalty`

必要要素:

- 120通り分布から算出した的中確率
- 確定オッズ予測分布とEV下側分位点
- モデル不確実性とオッズ不確実性
- 多数の券種・買い目から最大値を選んだ探索罰則
- データ品質罰則と流動性罰則

初期方針:

- 1レース最大1点
- 100円paper仮想投資
- 正の保守的スコアがなければSKIP
- edge確認前にKelly配分を使わない
- 複数点買いで見かけの的中率を上げない
- productionへ接続しない

## 新規取得データの優先順位

### P0: 全券種オッズ時系列

対象は単勝、複勝、2連単、2連複、3連単、3連複、拡連複。checkpoint候補はT-30、T-20、T-10、T-5、T-3、T-1、final-like。

保存品質情報:

- 取得時刻、締切予定時刻、実際のminutes-before-close
- source、parser version、fetch status
- selection coverage、同値異常、欠損、返還表示
- 重複防止キー

最初に公式サイトで、券種別の取得可能性、リクエスト数、HTML/JSON構造、利用条件、負荷を監査する。取得可能と決め打ちしない。

### P0: 全券種公式払戻

現在不足している単勝・複勝を含め、bet type、的中組み合わせ、100円払戻、人気順位、同着、返還、不成立、F/L、確定時刻、source、parser versionを保存対象とする。

### P0: 締切前風向

公式風向、風速、波高、会場形状に対する相対風向、向かい風・追い風・横風、1マークに対する相対角度、安定板、周回短縮を保存する。結果取得後の風向をレース前特徴量へ混ぜない。

### P0: 展示進入・展示情報

枠番、展示進入コース、枠番からのコース変更、展示STと順位、展示タイムと順位、チルト、部品交換、安定板、取得時刻を保存する。絶対値に加え、レース内相対差と会場・当日残差を将来計算できる形にする。

### P0: 結果原因データ

実進入、実ST、実着順、決まり手、F/L、転覆、落水、妨害、失格、返還、不成立を保存対象とする。外れを「1着から不正解」「上位2艇集合は正解」「上位2艇順序だけ不正解」「上位3艇集合は正解」「上位3艇順序だけ不正解」「事故・F/Lで通常分布が崩壊」「予測以前にデータ品質不足」に分解できるようにする。

### P1

- 券種別売上額、券種別投票増加量、買い目別投票額
- オッズ更新頻度、実効流動性proxy
- 選手のコース別ST平均・分散
- 決まり手への関与、攻めによる隣艇への影響proxy
- 当地・風向別戦法差

取得不能な項目は無理に推測しない。

## 今は優先しない特徴量

次は永久棄却ではないが、現時点の新規取得・新BUY条件の優先対象から外す。

- 誕生日、血液型、給与日、五十日
- 単純な曜日、単純な開催タイトル、オッズ末尾
- 個人名別ROIランキング、私的人間関係や噂
- 「今日は荒れている」という雰囲気だけ
- 全国勝率最上位艇への機械的買い替え
- 少数標本の会場×買い目セル

## 実装フェーズ

### Phase N0: 取得可能性・設計監査

公式ソース、現在DBの全券種coverage、単勝・複勝払戻欠損、API/HTML構造、リクエスト負荷、保存schema、一意キー、source quality、point-in-time、dry-run、migration案を監査する。この段階ではDB変更、実収集、モデル実装を行わない。

**2026-07-23完了。** 読み取り専用監査は[`../reports/all-bet-type-data-feasibility.md`](../reports/all-bet-type-data-feasibility.md)、取得設計は[`all-bet-type-data-acquisition-design.md`](all-bet-type-data-acquisition-design.md)、schema案は[`all-bet-type-schema-migration-design.md`](all-bet-type-schema-migration-design.md)を正本とする。7券種払戻の公式存在を確認したが、現DBは単勝・複勝が欠落する。live時系列は3連単専用で、売上・投票口数はBLOCKED。

選手PIT監査もN0へ統合した。`official_programs.raw_json`に当時級別・全国/当地勝率・2連率、`race_entries`に結果履歴が残り、strict-priorのコース・recent・pair・style proxyは再構築可能である。一方、`racer_profiles`と`racer_course_stats`は現在値1世代でhistoricalには使えず、3連率、事故率、集計窓・標本数、当日展示・部品交換推移等はsnapshot/append-only設計が必要である。M1はN3/N4のPIT gate、M3はstrict-prior相互作用gateを通過するまで開始しない。DB migration、実収集、モデル、production接続は未着手。

独自研究7軸のデータ前提監査も統合した。7軸はすべて`CONDITIONAL`。公式情報の市場反映遅延と全券種市場整合性は、source時刻と観測時刻を分けたversioned future-only取得が必須である。1マークは公式結果から共起proxyまで再構築できるが、攻撃艇・隣接艇への因果は公式telemetryなしでは判定不能。Error Atlas、strict-prior潜在水面evidence、選択的不確実性は既存rawを多く再利用できる有望軸だが、今回modelは実装していない。

### Stage F0: Research Replay Foundation（次の独立タスク）

N1より前に、immutable capture lifecycle、entity-body raw、parse run、typed observation、Manifestを分離し、raw/semantic二重change判定、raw security、単方向supersession、FC08A/FC14A、golden fixture、PIT/leakage guardを実装する。F0はtemp/sidecarだけで、`data/boat.sqlite`変更、live collector接続、モデルを含めない。

### Stage F0-R: Research Replay Foundation Rollout

F0 PASS後に、人間承認、DB copy、backup/restore、WAL/lock、crash recovery、disk、rollback、collector非回帰を確認してsidecar rolloutを行う。research writeはoptional shadow、default OFF、別transactionとし、失敗をprimary collectorへ伝播させない。bounded queue、retry/backpressure、kill switch、outbox/replay、health reportを持つ。無承認で`data/boat.sqlite`を変更しない。

### Phase N1: 全券種払戻基盤

単勝・複勝を含む払戻取得、fixture、parser、dry-run、idempotency、同着・返還・不成立、小規模canary、coverage reportを作る。予測ロジックは変更しない。

### Phase N2: 全券種オッズ時系列

取得可能な券種からappend-onlyで実装し、checkpoint、重複防止、source分離、rate limit、coverage監視、同値異常検査を持たせる。5画面を`market_observation_batch`で束ねるが、各response時刻とbatch内skewを失わない。point/range、発売なし、返還、raw矛盾を正本として保存する。市場整合性modelや120状態baselineは実装せず、既存3連単収集を壊さず、予測ロジックは変更しない。

### Phase N3: 物理環境・展示完全化

風向、会場相対風向、展示進入、展示ST、展示タイム、装備、point-in-time品質検査を完成させる。選手のprofile/period/course-period snapshot、支部・登録期・年齢・性別・直前体重を有効期間と集計窓付きで整備する。出走表・欠場・展示・気象・装備・締切変更をraw hash付きversionとして保存し、`source_published_at / source_observed_at / first_seen_at / changed_at`を分離する。measurement precisionとlate update可能性も観測rowに持たせる。予測ロジックは変更しない。

### Phase N4: 結果原因ラベル

実進入、実ST、決まり手、事故、外れ分解レポートを整える。`race_entries`等から、対象raceより厳格に前だけを使うrecent form、コース別能力、過去同走・直接対戦、戦法・隣接艇相互作用proxyを再構築する。1マークのpost-race label、会場・季節baselineへ縮小可能な水面evidence、candidate manifest固定のError Atlasを監査台帳として整備する。攻撃艇を主観で補完せず、因果や私的人間関係は扱わず、予測ロジックは変更しない。

### Phase N5: 120通り市場baseline

開始条件は、T-5全120通り、正式結果、既存の最低1,000 settled gate、point-in-time品質、frozen time splitの確認。

まずraw観測ID、range処理、控除根拠、券種別品質、時刻skew、制約残差を持つ120状態projection監査値と不確実性snapshotを固定する。その後に市場確率正規化、120通り合計検査、各券種への集約、market-only logloss/Brier/calibration、市場のみROI、券種別baselineを実装する。shadow/read-onlyのみ。SKIP予測器、Fragility Index、券種選択器はこの段階で自動的に開始しない。

### Phase N6: 市場offset残差モデル

強い正則化、M0市場baselineとの比較、時系列split、固定holdout、feature family単位の追加を行う。市場に勝たないfamilyは追加せず、productionへ接続しない。

### Phase N7: 確定オッズ分布・券種選択器

オッズ下落予測、券種横断整合性、conservative EV、uncertainty penalty、search penalty、1レース最大1点を実装し、paper shadowだけで動かす。

### Phase N8: formal forward検証

future-only、固定manifest、最大1・2的中除外ROI、logloss、Brier、calibration、CLV、最大DD、最大連敗、券種別coverage、block bootstrap、leave-one-venue、月次安定性、gate判定を行う。通過前はproductionへ接続しない。

## モデル比較の事前登録

- M0: T-5市場のみ
- M1: 市場offset＋選手・枠・モーター
- M2: M1＋風・波・展示・進入
- M3: M2＋1マーク展開・相互作用
- M4: M3＋オッズ時系列
- M5: M4＋全券種横断整合性
- M6: M5＋確定オッズ分布・券種選択

前段がM0を再現可能に上回らなければ後段へ進まない。評価項目はlogloss、Brier score、calibration、1着確率、上位2艇集合・順序、上位3艇集合・順序、券種別ROI、CLV、最大1・2的中除外ROI、最大ドローダウン、最大連敗、block bootstrap信頼区間、leave-one-venue、月次安定性とする。

## 研究ガバナンス

- 「当たる」と「市場価格を上回る」を分ける。
- ROIだけで採用せず、高配当数件への依存を確認する。
- placeboと多重探索罰則を置く。
- holdoutを探索へ戻さない。
- feature追加前に仮説と符号を登録する。
- 中間結果を見て閾値を変更しない。
- historical closingをT-5と呼ばない。
- post-hoc結果をforward証拠にしない。
- 同じレースを複数モデルの独立標本として数えない。
- 会場、開催日、節の相関を考慮する。
- production接続を独立gateにする。
- 自動購入を実装しない。

## 開始・停止gate

- Stage F0開始: N0完了、Legacy/New評価分離契約とF0境界の承認後、別タスクとして開始する。
- Stage F0-R開始: F0 temp/sidecar PASSとrollout readiness証跡、人間の明示承認後。
- Phase N1開始: F0-R completion gate通過後、N1設計を再レビューしてから。
- モデル学習開始: network-only T-5全120通りと正式結果が最低1,000 settledに到達し、point-in-time品質と固定splitが確認された後。
- production接続: N8のfuture-only検証と独立production gateを通過した後。それまでは禁止。
