#!/bin/bash
# 週次ルール候補レビュー（com.shogo.boat-pon.weekly-review、日曜 22:00）— 2026-10-15 に役目を終えた。
#
# 撤退（2026-10-07）で、ルール候補の監視は終了した。このレビューは毎週 docs/rule-candidates.md を書き換え、
# 精算件数も常に 0 と出していた（docs/reviews/2026-10-07-strict-review.md の課題 #10）。
# 当たり外れと精度は、毎晩のスコアカード（scripts/daily-line-summary.sh）と月曜の週次まとめが見ている。
#
# launchd の登録が残っていても何もしないで終わる。登録の解除はユーザー作業:
#   launchctl bootout gui/$(id -u)/com.shogo.boat-pon.weekly-review
# 以前の中身はタグ archive/before-minimal-20261015 にある。
echo "[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')] weekly-rule-review: 2026-10-15 に終了（何もしない）。launchd の登録を外してよい。"
exit 0
