# Stage F0 Research Replay Foundation

更新: 2026-07-24

## 結論

Stage F0のtemp/sidecar vertical sliceを実装した。ローカル実装・fixture検証は`COMPLETE`、Linux CIでのcross-environment golden hashは初回push前のため`PENDING_CI`である。CIが同じhashを返すまでF0総合判定は`CONDITIONAL`とし、F0-Rへ進まない。

実測証跡:

- [`../reports/research-replay-foundation.md`](../reports/research-replay-foundation.md)
- [`../reports/research-replay-foundation.json`](../reports/research-replay-foundation.json)
- [`../reports/research-replay-lineage.md`](../reports/research-replay-lineage.md)
- [`../reports/research-replay-golden-hash.md`](../reports/research-replay-golden-hash.md)

## Architecture

metadataはSQLite sidecar、entity body bytesはcontent-addressed filesystemへ保存する。CLI・testの既定はOS temp directoryであり、`data/research-replay.sqlite`を自動作成しない。`data/boat.sqlite`、collector、API、decision経路には接続していない。

五層を別entityとして実装した。

1. `capture_attempts`とappend-onlyな`capture_attempt_events`
2. `raw_documents`と`capture_raw_links`
3. `parse_runs`
4. `domain_observations`と厳格validator付き`typed_observation_payloads`
5. `race_asof_manifests`、expectations、items

sidecar schema versionは`f0.1.0`、reader/writer contractは`f0-reader-v1` / `f0-writer-v1`。migration ledgerとchecksumを検証し、unknown version、partial status、checksum不一致はdefault denyする。証拠tableの`UPDATE`と`DELETE`はDB triggerで拒否する。

raw pathは`sha256/ab/cd/<full-sha256>`だけから生成する。同一bodyは一度だけ保存し、capture履歴は別rowで残す。temp fileを`0600`で作り、write、fsync、atomic rename、directory fsyncを行う。raw rootは`0700`、sidecarは`0600`である。

## Canary payload

pre-race:

- `race_schedule`
- `trifecta_market`
- `beforeinfo`

rejection:

- `race_result`
- `current_racer_profile`
- `historical_closing_odds`
- `fixture_only`

型付きpayloadはpayload typeごとのfield集合を固定し、unknown field、不正selection、unknown schema、payload参照欠損を拒否する。自由形式JSONをdomain observationとして採用しない。

## Resolver / PIT

versioned policy:

- `rr-strict-pre-race-v1`
- `live-t5-strict-canary-v1`

resolverはsource priority、staleness、tie-break、required/optional、forbidden typeを固定する。manifestは`found / missing / stale / rejected / not_published / not_observed / not_offered / parse_error / timing_ambiguous / point_in_time_ineligible`を保存する。required inputを暗黙補完しない。

PIT guardは、観測・公開・first-seenがas-of後、post-race、current profileの過去利用、historical closingのlive利用、fixtureのlive利用、unknown type/schema/parser、race不一致、schedule version欠損をmachine-readable codeで拒否する。同一millisecondはinclusive境界として受理する。

market checkpointは`scheduledCloseObservationId`、`scheduledCloseAtSeen`、`minutesBeforeCloseAtCapture`、`checkpointLabelAtCapture`、policy versionをpayloadへ凍結する。後の締切変更で旧T-5を再計算しない。

## Append-only / Evidence Pin

訂正は新rowの`supersedes_id`、`correction_kind`、`correction_reason`だけで表し、旧rowを更新しない。raw再parseは新しいparse runとobservationを作り、旧run・observation・manifestを保持する。

manifest作成時にraw、parse run、observationを`evidence_pins`へ追加する。GC dry-runはpinned rawを`retain_pinned`とし、実削除は行わない。orphan body、orphan metadata、integrity mismatchを監査する。actual GC、quota、low-water mark、backup/restore、crash recoveryはF0-Rの責務である。

## Security contract

- Authorization、Cookie、Set-Cookieを保存しない。
- response headerはallowlistだけを保存する。
- token/key/secret等のquery値をredactする。
- content type、charset、entity body size、decompressed size、ratioを制限する。
- path traversalとsymlink root/targetを拒否する。
- raw body全文をreportへ出さない。
- fixtureはsanitized dataだけで、外部HTTP、secret、`boat.sqlite`を必要としない。
- `.gitignore`は`data/raw/`、`data/*.sqlite`、temp/logを除外する。

Stage F0専用の暗号鍵管理は追加していない。live rollout前に既存基盤の有無をF0-Rで再確認する。

## Canonical / Golden

`rr-c14n-v1`はsorted object keys、ordered/unordered arrayの区別、UTF-8、Unicode NFC、UTC millisecond、有限number、`-0=0`、NULL/missing分離、locale非依存を固定する。

fixture versionは`rr-golden-fixture-v1`。timezone/JST日付跨ぎ、同一millisecond、float、range、NULL/missing、Unicode、array order、checkpoint変更、future/result/current-profile/historical-closing/fixture-onlyを含む。golden変更は理由、version bump、期待差分を伴う別commitでだけ行う。

## CLI

```bash
pnpm research:replay:canary
pnpm research:replay:canary -- --write-reports
pnpm research:manifest:dry-run
pnpm research:raw-cache:audit
pnpm research:schema:verify
pnpm research:golden:verify
```

すべてtemp directoryを既定とし、外部HTTPを呼ばない。report生成時だけrepoの`reports/`へ集計結果を書き、raw bodyやsidecar DBは書かない。

## Contract result

| Contract | F0 result |
|---|---|
| FC01 / FC01A | 五層lineageとimmutable capture lifecycleを実装 |
| FC02 / FC02A / FC02B | raw/semantic hash、7分類、raw byte/securityを実装 |
| FC03 | race key、venue、race no、trifecta selectionを実装 |
| FC04 | checkpoint freezeを実装 |
| FC05 | 2つのversioned resolver policyを実装 |
| FC06 | manifest completenessを実装 |
| FC07 | new-row-only supersessionとDB append-only guardを実装 |
| FC08A | manifest pin、tombstone schema、orphan監査、GC dry-runを実装 |
| FC11 | temp sidecar隔離を実装。`data/boat.sqlite`非変更を監査 |
| FC13 | canonical hashを実装 |
| FC13A | local golden PASS。Linux CIは初回pushまでPENDING |
| FC14A | schema ledger/checksum/default-denyを実装 |

FC08B、FC12、FC14BはF0-Rであり未実装。FC09、FC10はD1の責務である。

## F0-Rへ残すもの

- sidecar実配置とshadow write default OFF
- outbox/replay、bounded queue、retry/backpressure
- collector failure isolation
- operational GC、quota、disk kill switch
- backup/restore、crash recovery
- partial migration resumeとold reader rollout
- human approval

これらを自動開始しない。F0-R完了前にN1へ進まない。
