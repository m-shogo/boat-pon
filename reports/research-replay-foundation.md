# Stage F0 Research Replay Foundation

- F0 implementation: **COMPLETE**
- Cross-environment: **PASS**
- Sidecar schema: `f0.1.0`
- Fixture: `rr-golden-fixture-v1`
- Raw documents / linked captures: 10 / 11
- Parse runs / observations / manifests: 10 / 10 / 2
- Dedup ratio: 1.100
- Manifest hash: `2a260066a35a90c0ab2a10bf65106c2b54a89cabf1559998080dbdd63cad03c3`

## Completion evidence

- Five-layer lineage: PASS
- Immutable capture lifecycle: PASS
- Raw entity-body dedup/integrity: PASS
- Parser replay and supersession: PASS
- Manifest completeness/checkpoint freeze: PASS
- PIT/leakage guard: PASS (10 rejection canaries)
- Evidence pin/GC dry-run: PASS
- Schema contract: PASS

## Boundaries

- `data/boat.sqlite`へwrite connectionを開いていない。
- 外部HTTP、live collector、BUY/WATCH/SKIP、Legacy ROIへ接続していない。
- F0-R、N1、モデル、production接続は未着手。

## Remaining

- F0-R live shadow write、outbox、operational GC、backup/restoreは未実装
