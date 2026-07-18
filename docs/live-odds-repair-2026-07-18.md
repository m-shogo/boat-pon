# live odds経路修正記録（2026-07-18）

## 承認と範囲

ユーザーから、候補オッズ上書き修正とT-5収集経路変更について説明後に「進めて」と明示承認を受けた。

変更対象:

- 買い目別オッズをレース単位fallbackより優先
- 同一レースの公式オッズ取得を候補数回から1回へ集約
- decision_history保存前にモデルtop1を1レース1件へ固定
- 収集間隔を15分から5分へ変更
- T-5 bucketを締切5〜10分前として扱う

変更しないもの:

- `app_settings`
- BUY/SKIP閾値
- モデル確率
- 自動投票・実購入
- 既存decision_historyの書き換え

## 変更前後の監査

- 修正前: 買い目別オッズ不一致 6,510/6,695行
- 修正後read-only再計算: 不一致 0行
- 過去保存top1: 5/65一致。既存行は更新せず、今後分だけ正常化する

## LaunchAgent

- job: `com.boatpon.auto-odds`
- 新設定: `StartInterval=300`、`--scheduled`、JST 09:00〜21:05以外はDBを開かず終了
- 変更前plistバックアップ: `/Users/m-shogo/Library/LaunchAgents/com.boatpon.auto-odds.plist.backup-20260718-1900`

## 戻し方

1. 上記バックアップを `~/Library/LaunchAgents/com.boatpon.auto-odds.plist` へ戻す。
2. `launchctl bootout` → `launchctl bootstrap` で再登録する。
3. コードはこの変更コミットをrevertする。

DBの削除・過去行修正は戻し手順に含まない。
