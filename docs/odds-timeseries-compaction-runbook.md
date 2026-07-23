# Odds timeseries compaction runbook

更新: 2026-07-21

## 目的

旧収集器が同一race/checkpointを反復保存した時系列重複を、完全市場と最新状態を失わずに別DBへcompactする。

現行DBを直接DELETE・VACUUMしない。原本を残し、別パスの候補DBを作成して検証後に切り替える。

## 保持契約

race/checkpointごとに次を保持する。

1. checkpoint目標分に最も近い、単一`captured_at`で120通り揃ったcapture
2. 最新capture
3. 1と2が同一なら1セットだけ
4. 完全captureが無ければ最新captureだけ

目標分はT-30=30、T-20=20、T-10=12、T-5=5。最新が60通り等の部分市場でも、過去の完全120通りを消さない。

## 現在の計画結果

- 対象: 2026-06-01〜2026-07-20
- 元rows: 48,875,702
- 保持rows: 1,133,023（2.32%）
- 削減候補: 47,742,679
- 完全市場group: 9,342/9,342保持
- 推定: 13.98GiB → 6.04GiB（約7.94GiB回収）

## 人間による保守作業の必須順序

1. 当日の全レース・通知処理が終わった時間帯を選ぶ。
2. `auto-odds`を停止し、停止状態と最終終了コード0を確認する。
3. 空き容量が原本・バックアップ・候補DBを同時保持できることを確認する。
4. SQLite Online Backup API等でタイムスタンプ付き原本バックアップを作り、サイズと読み取りを確認する。
5. 原本を直接変更せず、別パスに候補DBを作る。
6. 候補DBの時系列だけを保持契約に従ってcompactする。
7. 候補DBで`integrity_check`、保持rows、完全市場group、fingerprintを検証する。
8. T-5市場baselineと残差レポートを原本・候補で比較し、n・logloss・Brier・ROIが一致することを確認する。
9. 原本をリネームして保持したまま、候補DBをatomic renameで切り替える。
10. read-only health check後に`auto-odds`を再開し、1回の正常終了と新規120行保存を確認する。
11. 原本バックアップは即削除せず、ロールバック期間を設ける。

## 機械検証

計画の再生成:

```bash
pnpm plan:odds-timeseries-compaction -- --from 2026-06-01 --to 2026-07-20
```

候補DB作成後のread-only比較:

```bash
pnpm verify:odds-timeseries-compaction -- \
  --source data/boat.sqlite \
  --candidate /absolute/path/to/boat.compact.sqlite \
  --from 2026-06-01 \
  --to 2026-07-20
```

`passed=true`に加え、市場baseline・残差レポート一致を必須とする。

候補DB作成コマンドは原本と同じパスを拒否し、既存候補の上書きを拒否し、`auto-odds`がunloadされていなければ停止する。

```bash
pnpm build:odds-timeseries-compact-candidate -- \
  --source data/boat.sqlite \
  --candidate /absolute/path/to/boat.compact.sqlite \
  --from 2026-06-01 \
  --to 2026-07-20 \
  --confirm BUILD_COMPACT_CANDIDATE_ONLY
```

このコマンドは候補DBだけを変更し、原本を切り替えない。完了後に必ず上記verifyコマンドを実行する。

## 禁止事項

- 稼働中DBへ直接DELETEする
- バックアップ未確認でVACUUMする
- 候補DBのfingerprint不一致を無視して切り替える
- 原本を先に削除する
- 収集ジョブを動かしたままDBを入れ替える

この作業はDB書き込みとbackground service停止を伴うため、エージェントは実行しない。人間が明示承認した保守枠で実施する。
