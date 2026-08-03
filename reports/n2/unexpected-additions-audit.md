# Unexpected settlement additions audit（read-only）

- generated: 2026-08-03T07:11:39.381Z
- scope: read-only immutable-source scan; no DB/archive/sidecar write
- source: /Users/m-shogo/Developer/personal/boat-pon/data/research-replay.sqlite
- archive files scanned: 8174 / ingested: 8167
- unexpected_addition: **2** / ambiguous_non_defect: 0
- classification contract: n2-reparse-addition-classification-v1
- auto-apply eligible: 0

### 保留 1: 2014-03-28:08:R1 / win

- classification: **CONFIRMED_V1_WIN_REFUND_OMISSION** / auto-apply eligible: false
- reason: no v1 candidate exists for this race+bet_type and v2 derives a refunded candidate: a distinct v1 refund-omission defect, outside the V1_SPECIAL_PAYOUT_FALSE_REFUND reparse scope. Hold for a separately-approved correction.
- date/venue/race: 2014-03-28 / venue 08 / R1
- v2: status=refunded, result_kind=normal, payout_lines=0, refund_lines=1, selections=[]
- raw: doc 1947bdfd-79c5-4517-836a-a02f1c7d8480, sha256 ac9991361e6ca32b…, archive k140328.lzh
- sidecar candidates for race+bet: []

### 保留 2: 2014-03-28:17:R2 / win

- classification: **CONFIRMED_V1_WIN_REFUND_OMISSION** / auto-apply eligible: false
- reason: no v1 candidate exists for this race+bet_type and v2 derives a refunded candidate: a distinct v1 refund-omission defect, outside the V1_SPECIAL_PAYOUT_FALSE_REFUND reparse scope. Hold for a separately-approved correction.
- date/venue/race: 2014-03-28 / venue 17 / R2
- v2: status=refunded, result_kind=normal, payout_lines=0, refund_lines=1, selections=[]
- raw: doc 1947bdfd-79c5-4517-836a-a02f1c7d8480, sha256 ac9991361e6ca32b…, archive k140328.lzh
- sidecar candidates for race+bet: []


> 期待値合わせで保留2件を強制訂正しない。auto-apply は raw provenance 完全・identity 一意・v2 semantics 正本一致・
> source duplicate でない・append-only lineage 構築可能・317,747件と同等の証拠強度、をすべて満たす場合のみ。
