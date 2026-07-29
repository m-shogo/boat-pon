# N1-C data-quality finding — 4 source archive files に intra-file 重複

更新: 2026-07-29
status: **DISCOVERED → RESOLVED_CANONICALLY**（append-only source_duplicate resolution 適用済み）
分類: **source-data defect（N1 pipeline bug ではない）/ 値誤りなし / reconciliation で完全説明済み（unexplainedDelta=0）**

> raw source defect は歴史的事実として保持する（「なかったこと」にしない）。raw provenance（重複 observation/candidate）は削除せず、canonical evaluation で重複 copy を 1 回だけ有効化する append-only mapping（`settlement_source_duplicate_resolutions_v2`, `n1-settlement.0.3`）で解決した。

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

## Resolution（append-only canonical resolution・2026-07-29 適用）

破壊的操作（DELETE/UPDATE/VACUUM/mass-fix）は一切行わない。raw は immutable。

- schema `n1-settlement.0.3`（expand-only、0.1/0.2 byte 不変）で `settlement_source_duplicate_resolutions_v2`（append-only）を追加。
- 決定的 canonical: 各 race の source 順で最初の observation（`domain_observations.rowid` 昇順）を canonical original とし、後続の重複 observation を `source_duplicate` として mapping。timestamp/実行順の偶然に依存しない。
- value-equality を事前検証: 624 races すべてで 2 observation の candidate 集合（bet_type, semantic_hash）が完全一致（groups_with_count_ne_2=0）→ exact source duplicate。値が異なる場合は resolution せず conflict/停止（本件は 0 conflict）。
- 適用結果（`source-duplicate-resolution.json`）: inserted resolutions **624**、re-run で **0 new（冪等）**。
- **raw 不変**: observations 1,194,679 / candidates 8,154,709 unchanged、rawDuplicateObservations **624**・rawRaceLevelDuplicateCandidates **4,196** は audit-visible のまま保持。
- **canonical active**: activeDuplicateObservations **0** / activeCanonicalRaceLevelDuplicateCandidates **0**。sourceDuplicateExcludedCandidates 4,196 = rawRaceLevelDuplicateCandidates 4,196、unexplainedCanonicalDelta **0**。

## 恒久 invariant（PHASE 3）

canonical race-level uniqueness を quality gate へ昇格:

- raw（source 忠実）: race-level 重複は存在してよい（現 4,196、audit 可能）。
- **active canonical（source_duplicate 除外）: 必ず 0**。`verify` / reconciliation analyzer に組込済み。将来 source archive に同種 duplication が入っても無言で二重計上しない（future ingest guard `detectExactDuplicateObservationsInRaw`、value 差は conflict/revision path へ）。

## 判定

- Debt A（authoritative full verify）/ Debt B（+5,153 reconciliation）: 解消済み。
- 本 finding: **RESOLVED_CANONICALLY**（raw 保持・canonical active 0・append-only・冪等・値誤りなし）。
- 残る CONDITIONAL 要因は N1-C 本体の debt ではなく、live-archive の日次 incremental 運用と remote CI の runner allocation 状態に依存する。
