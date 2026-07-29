# N1-C data-quality finding — 4 source archive files に intra-file 重複

更新: 2026-07-29
分類: **source-data defect（N1 pipeline bug ではない）/ 値誤りなし / reconciliation で完全説明済み（unexplainedDelta=0）**
判定影響: **Overall N1-C を CONDITIONAL に留める根拠**

## 概要

`+5,153` 行 reconciliation の過程で、`filtered = -11,658`（processed > rawParsed）という異常を検出。原因を source まで追跡した結果、**4 個の日次 `.lzh` archive が、その日の結果を単一 `.TXT` 内に物理的に重複格納している**ことが判明した。

| file | date | 解凍サイズ | 正常日目安 | 重複 condition | 重複 line |
|---|---|---:|---:|---:|---:|
| `k080706.lzh` | 2008-07-06 | 419,132 B | ~196 KB | 180 | 3,360 |
| `k080713.lzh` | 2008-07-13 | 474,430 B | ~196 KB | 204 | 3,724 |
| `k090406.lzh` | 2009-04-06 | 336,512 B | ~150 KB | 144 | 2,708 |
| `k090708.lzh` | 2009-07-08 | 224,896 B | ~150 KB | 96 | 1,866 |
| **計** | | | | **624** | **11,658** |

`unar` 解凍後の `.TXT` が正常日の約 1.1〜2.1 倍で、同一 race block が重複している（`k090708` は部分重複）。`.lzh` は各 1 `.TXT` のみ（multi-file archive ではない）。parser は重複を作らず、**source に重複が存在する**（他 8,164 file には重複 condition なし）。

## N1 への影響

- backfill は source を faithful に取り込むため、重複した race condition ごとに別 `observation_id` を採番し、**同一 race×bet×payout の candidate が別 observation 下に重複**して格納される。
- `UNIQUE(observation_id, bet_type, semantic_hash)` は observation 単位のため、この cross-observation 重複を検出しない（verify の `duplicateSemanticCandidates=0` は observation 単位で正）。
- 影響規模（quiescent DB 実測）:
  - duplicate observations = observations 1,194,679 − distinct race keys 1,194,055 = **624**（source の 624 duplicate condition と一致）。
  - race-level duplicate candidates = total 8,154,709 − distinct(canonical_race_key,bet_type,semantic_hash) 8,150,513 = **4,196**。
  - duplicate payout+refund lines = **11,658**。
  - 影響: 4 file / 4 日 / store 全体の約 0.05%（candidate 0.051%）。
- **値は正しい**（legacy comparison payout mismatch 0）。件数の重複（multiplicity）であり value 誤りではない。
- observation 単位 dedup（verify の `duplicateSemanticCandidates`）は 0 だが、race 単位（canonical_race_key,bet_type,semantic_hash）では 4,196 の重複が残る。
- 下流集計（当該 4 日の ROI 等）で二重計上の可能性がある。

## reconciliation 上の扱い

- `filtered(-11,658)` はこの source 重複による over-processing、`dedupRemoved(11,657)` は別 race の intra-candidate 重複行で、両者は**別 race 由来**だが規模がほぼ一致し、line count は net +1（実質一致）。
- **unexplainedDelta = 0**：本 finding も含めて完全に説明済み。`simMatchesDb=true` で sim と DB 実測が一致。

## 修正提案（本 closure では実施しない）

破壊的操作（DELETE/VACUUM/mass-fix）は行わない。以下を別タスク・別承認で検討する。

1. 当該 4 `.lzh` を source から clean 版で再取得し、SHA を比較して重複格納の有無を確定。
2. clean 版で置換後、当該 4 file を対象に append-only の supersession/quarantine（重複 observation を `source_conflict`/`corrected` ではなく「intra-file duplicate」理由で無効化）で重複 candidate を論理的に除外。
3. あるいは下流集計側で race-level（canonical_race_key, bet_type, semantic_hash）dedup を適用。

いずれも本 N1-C closure の scope 外であり、実施前に scope・affected rows・手順を提示して承認を得る。

## 判定

- Debt A（8,168 full verify）: 解消（integrity/fk/observation-level dedup/coverage）。
- Debt B（+5,153 reconciliation）: 解消（unexplainedDelta=0、parser determinism 0）。
- 本 finding により store に race-level 重複が残るため、**N1-C acceptance は COMPLETE に昇格せず CONDITIONAL**。source-data 由来・値誤りなし・完全説明済みだが、未解決の data-quality item として明記する。
