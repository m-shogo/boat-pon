export type GlossaryTerm = {
  id: string;
  label: string;
  plainDescription: string;
  whyItMatters: string;
  howToRead: string;
  commonMistake: string;
  formulaOrExample: string;
  detailPath: string;
  updatedAt: string;
};

const UPDATED_AT = "2026-08-05";

export const GLOSSARY_TERMS = {
  roi: term("roi", "ROI", "賭けた金額に対して、いくら戻ったかを表す割合です。", "的中率が高くても払戻が小さければ収益は残らないためです。", "100%が損益ゼロ、100%超がプラス、100%未満がマイナスです。", "少数の大当たりだけで高くなったROIを安定した実力と誤解することです。", "払戻合計 ÷ 購入額合計 × 100。10,000円購入して11,000円戻れば110%。"),
  hitRate: term("hit-rate", "的中率", "購入または評価した候補のうち、当たった割合です。", "予測の当たりやすさを確認できますが、収益性はオッズと合わせて判断します。", "必ずsample sizeと券種・条件を一緒に見ます。", "的中率だけで利益が出ると考えることです。", "的中数 ÷ 対象数 × 100。10件中3件なら30%。"),
  ev: term("ev", "EV", "同じ条件を長く繰り返したときに期待される平均的な価値です。", "当たりやすさと払戻の大きさを一つの尺度で比較できます。", "1.00が理論上の損益ゼロ目安で、推定誤差と市場変化も考慮します。", "EVが1を超えれば必ず次の1回で勝てると考えることです。", "推定的中率 × オッズ。的中率5%・オッズ25倍なら1.25。"),
  requiredOdds: term("required-odds", "必要オッズ", "推定的中率から逆算した、損益ゼロまたは目標EVに必要な最低オッズです。", "現在オッズが十分かを購入前に判断する基準になります。", "現在オッズと比較し、締切前の変動も確認します。", "予測モデルが出した固定の払戻倍率だと誤解することです。", "損益ゼロ基準なら 1 ÷ 推定的中率。的中率5%なら20倍。"),
  currentOdds: term("current-odds", "現在オッズ", "最後に観測できた時点の市場オッズです。", "必要オッズを上回っているか、情報が古くないかを確認するためです。", "観測時刻と締切を必ず一緒に見ます。", "画面表示後も同じ倍率で購入できると考えることです。", "15:00観測25.4倍でも、締切時には変動します。"),
  calibration: term("calibration", "calibration", "予測した確率と実際の的中割合が合っているかを確認することです。", "確率が過大評価ならEVも過大になり、BUY判断が崩れるためです。", "予測10%の集合が実際にも約10%当たるかを帯ごとに見ます。", "ランキング精度が高ければ確率も正しいと考えることです。", "予測10%の100件で約10件的中なら概ねcalibrated。"),
  drawdown: term("drawdown", "drawdown", "資金の過去最高点から、どれだけ落ち込んだかです。", "最終ROIだけでは見えない途中の苦しさと資金耐性を示します。", "最大値、継続期間、回復までの期間を確認します。", "最後に利益なら途中の大幅損失を無視してよいと考えることです。", "資金10万円から7万円まで落ちれば30% drawdown。"),
  maxHitDependency: term("max-hit-dependency", "max-hit依存", "最も大きな1回の払戻を除くと成績がどれだけ変わるかです。", "偶然の一撃でROIが良く見えていないか確認できます。", "通常ROIと最大払戻除外ROIを並べます。", "高配当が入ったこと自体を悪いとみなすことです。問題は依存度です。", "ROI130%でも最大1件除外で82%なら依存が大きい状態。"),
  historical: term("historical", "historical", "過去データを使って条件やモデルを評価した結果です。", "探索には有用ですが、同じデータへの過適合が起きやすいためです。", "期間・探索回数・未使用データの有無を確認します。", "過去に良かった条件が今後も同じように続くと断定することです。", "2020〜2024年を使ったバックテスト。"),
  forward: term("forward", "forward", "条件を決めた後に到着した新しいデータで評価した結果です。", "探索に使っていない時間方向のデータで再現性を確認できます。", "条件固定日、開始日、sample sizeを確認します。", "過去期間を時系列分割しただけの結果を実運用forwardと呼ぶことです。", "2026-06-01に条件固定し、以後のレースだけを集計。"),
  paperLive: term("paper-live", "paper-live", "実際の時刻・取得条件で判定するが、お金は購入しない検証です。", "データ遅延やオッズ変動を含む実運用に近い問題を安全に確認できます。", "通知時点、締切、取得失敗、見送りも含めて評価します。", "historicalバックテストをpaper-liveと呼ぶことです。", "毎日の候補を保存し、購入せず結果だけ追跡。"),
  pit: term("pit", "PIT", "その判断時点で本当に利用できた情報だけを使う原則です。", "未来情報の混入による見せかけの高成績を防ぎます。", "観測時刻・公開時刻・race締切の前後関係を確認します。", "DBに過去日付が入っていれば当時利用可能だったと考えることです。", "レース結果や確定払戻はレース前の特徴量に使用しない。"),
  holdout: term("holdout", "holdout", "探索や調整に使わず、最後の確認まで封印するデータです。", "何度も試した結果の偶然当たりを見抜くためです。", "freeze、使用回数、開封条件を確認します。", "結果を見て条件を直した後も同じholdoutと呼び続けることです。", "2025年の一部レースを最終確認まで非公開にする。"),
  commonCohort: term("common-cohort", "common cohort", "複数モデルを同じ対象レース集合で比較する方法です。", "データ有無の違いをモデル性能差と誤認しないためです。", "両方が評価可能な共通集合の件数を確認します。", "モデルごとに異なる母集団のROIを直接比較することです。", "AとBの両モデルが予測できた1,000レースだけで比較。"),
  experiment: term("experiment", "Experiment", "仮説・方法・評価指標を事前に固定した確認研究です。", "結果を見ながら都合よく判定基準を変えることを防ぎます。", "事前登録、対象データ、成功・失敗条件を確認します。", "探索中の思いつきを確定的なExperimentとして扱うことです。", "EXP-012: 未使用期間でROIとcalibrationを評価。"),
  discovery: term("discovery", "Discovery", "新しい傾向や候補を探索的に見つける段階です。", "有望な仮説を広く探せますが、そのまま採用はできません。", "探索結果として読み、別データで確認予定かを見ます。", "Discoveryの高ROIを本番採用根拠にすることです。", "DISC-021で会場×風の候補を発見し、後続Experimentへ送る。"),
  rejection: term("rejection", "Rejection", "再現しなかった仮説や採用しない条件の記録です。", "同じ失敗を繰り返さず、探索の選択バイアスを減らします。", "棄却理由、使用データ、再開条件を確認します。", "悪い結果を削除して成功例だけ残すことです。", "REJ-008: holdoutでROI基準未達のため終了。"),
  intent: term("intent", "intent", "研究runnerへ渡す、実行したい1回分の正式な依頼です。", "誰が何をどの安全レベルで実行したかを追跡できます。", "taskId、authority SHA、safety level、処理済み状態を見ます。", "intentを書けば必ず実行されると考えることです。guardで拒否される場合があります。", "TASK-N2-010をL0で1回実行するJSON依頼。"),
  runner: term("runner", "runner", "研究taskを実際に実行するMac側の処理環境です。", "GitHub上の依頼だけでは大容量local dataを読めないためです。", "online/busy、last run、lock、failure classを確認します。", "runner onlineを研究結果PASSと同じ意味にすることです。", "self-hosted runnerがsidecarをread-onlyで開く。"),
  queueState: term("queue-state", "queue-state", "各研究taskのREADY・PASS・BLOCKEDなどの実行状態を保持する正本です。", "依存関係と再実行を安全に管理できます。", "catalog versionとの一致とstale definitionを確認します。", "mainのtask定義とautomation branchの状態を手動で混ぜることです。", "TASK-N2-010=READY、依存TASK-N2-001..006=PASS。"),
  sidecar: term("sidecar", "sidecar", "本体DBと分離した研究用の大容量SQLiteデータです。", "研究処理を本番判断・設定から隔離できます。", "read-only、schema version、WAL状態、容量を確認します。", "公開Webから直接接続してよいDBだと考えることです。", "Mac上の研究用sidecarをimmutable read。"),
  wal: term("wal", "WAL", "SQLiteが変更途中の内容を一時的に保持するログファイルです。", "active WALがあるDBをコピー・解析すると整合性問題が起きる可能性があります。", "quiescentか、正しい接続方法かを確認します。", "WALファイルがあれば必ず破損していると考えることです。", "research guardはactive WAL時に開始を拒否。"),
  safetyLevels: term("safety-levels", "L0〜L4", "研究自動化の変更リスクを段階で表す分類です。", "安全なread-only作業と、本番影響のある作業を同じ権限で実行しないためです。", "L0/L1/L2は許可範囲、L3は明示grant、L4は常時拒否などpolicyを確認します。", "数字が大きいほど研究品質が高いレベルだと考えることです。", "L0=read-only、L4=自動購入など禁止領域。")
} satisfies Record<string, GlossaryTerm>;

function term(
  id: string,
  label: string,
  plainDescription: string,
  whyItMatters: string,
  howToRead: string,
  commonMistake: string,
  formulaOrExample: string,
): GlossaryTerm {
  return {
    id,
    label,
    plainDescription,
    whyItMatters,
    howToRead,
    commonMistake,
    formulaOrExample,
    detailPath: `/glossary/${id}`,
    updatedAt: UPDATED_AT,
  };
}

export type GlossaryTermKey = keyof typeof GLOSSARY_TERMS;

export function getGlossaryTerm(key: GlossaryTermKey): GlossaryTerm {
  return GLOSSARY_TERMS[key];
}
