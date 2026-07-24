# Research Replay Lineage

```text
capture_attempt -> capture_attempt_event -> capture_raw_link -> raw_document
raw_document -> parse_run -> domain_observation -> typed_observation_payload
domain_observation -> race_asof_manifest_item -> race_asof_manifest
race_asof_manifest -> evidence_pin(raw / parse / observation)
```

- 訂正は新rowの`supersedes_id`だけで表す。
- 旧rowと旧manifestはUPDATEしない。
- manifest参照証拠はGC dry-runで`retain_pinned`になる。
