# Forward Vault v0.2 — official race-results download documentation boundary audit (2026-10-26)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, public-documentation-only follow-up to the v350 official settlement-source capability review. This report is not a verified download payload, a provider contract, a source-authenticated correction feed, an approved data license, a trusted clock, a complete revision history, an implemented verifier, or scoring/production authority. No raw result archive, private odds, credentials, private paths, protected N2 execution, Current BUY, LINE, public publishing, automated betting, production setting, or Owner Dashboard was accessed or changed.

## Bounded question and method

Does the **official race-results download route**, as publicly documented and inspectable without fetching result files, establish (a) a usable documented distribution surface, (b) source-authenticated revisions and finality, and (c) permission for the intended research use?

Read on 2026-10-26: official download index, linked K-index landing page, official 2025 service-retirement notice, official site policy and service/update notes; searched for official K-specific format, correction/version/checkpoint, rights and revocation documentation. No archives or historical results were fetched. The K-index URL opened in the text-extraction tool but yielded **zero extractable lines**; this is an **inspection limitation**, not evidence that the service is empty, broken, unsigned, undocumented or discontinued.

### Public evidence and source attribution

1. Official BOAT RACE download page: https://boatrace.jp/owpc/pc/extra/data/download.html — separately links **競走成績ダウンロード** (nationwide 24-venue results) to https://www1.mbrace.or.jp/od2/K/dindex.html and **番組表ダウンロード**. Its LZH note and layout link appear under the *separate racer-period statistics* heading; do **not** automatically apply that format/layout assertion to K result files without checking the K provider documentation.
2. K landing page: https://www1.mbrace.or.jp/od2/K/dindex.html — direct public page lookup returned an addressable HTML resource but **no machine-readable page text** in this audit environment. We did not inspect its source bytes, linked archives, payload layout, headers, archive versions, correction notices, signatures or license.
3. Official retirement notice, dated **2025-03-05**: https://www.boatrace.jp/owpc/pc/site/news/2025/03/41685/ — ends **番組表閲覧**, **オッズ情報・結果**, and **競走成績閲覧**. The announcement does **not** list **競走成績ダウンロード** as retired. The current official download page still links the K service. Therefore do not misclassify the download service as discontinued, and do not infer from a link alone that every archive/date remains available.
4. Official site policy: https://www.boatrace.jp/owpc/pc/extra/policy.html — the boatrace.jp operator disclaims accuracy, certainty and continuing freshness; content/URLs can change without notice. It restricts reproduction, modification and redistribution beyond permitted use without permission, and disclaims implied IP licenses. **Scope caveat:** the K landing page is on a different host; these boatrace.jp terms are **not proof of the K host's own contractual license or permitted bulk use**. Both applicable terms and intended research rights must be reviewed separately before ingestion.
5. Official site service/update notes: https://www.boatrace.jp/owpc/pc/extra/about.html — describes website availability and several **other** information update schedules, but supplies no authenticated K-archive correction watermark or revision completeness proof in the inspected text. Do not re-label site display/update times as K archive publication/finality timestamps.
6. Unofficial technical examples may describe daily LZH K archives, but are **not** the issuing source's format contract, rights grant, signed changelog, or completeness proof. No third-party archive filename convention is promoted to an official specification.

## Capability/rights matrix

| Claim | Observed evidence | Decision |
| --- | --- | --- |
| Official navigation to K results download | Current official index links to K landing page | **LINK_DOCUMENTED**, not payload verified |
| K archive bytes, file layout, coverage, encoding and current availability | Not downloaded; K landing-page text not extractable | **UNINSPECTED** |
| Archive publication schedule, updates/replacements, revision identity, retention | No authenticated K-specific public specification verified | **NOT_ESTABLISHED** |
| Source-authenticated issuer/signature, monotonic correction order and inclusive range checkpoint | No K-specific proof located in reviewed public documentation | **NOT_ESTABLISHED**, not proof of global nonexistence |
| Finality, post-FINAL correction and refund/void exact-ticket binding | No independent K-source policy/attestation established | **NOT_ESTABLISHED** |
| Permitted automated collection, retention, transformation and redistribution | boatrace.jp policy reviewed; separate K-host permissions not established | **RIGHTS_REVIEW_REQUIRED** |
| 2025 retirement scope | Notice names three viewing services, not the download route | **DO_NOT_INFER_DOWNLOAD_RETIRED** |

**Critical distinction:** HTTPS transport, an official outbound link, archive bytes, a hash calculated after download, matching displayed payouts, or a local polling timestamp would at most establish *observed content*, not independent source-signed correction order, inclusive completeness through a checkpoint, or finality. An archive that can be overwritten in place without a verifiable revision log cannot prove an omitted predecessor or late correction does not exist. Do not infer positive attestation from the absence of documentation in this limited audit.

## Decision, falsifiers and next dependency

The minimum independent-source package needed for any future **separately reviewed** verification includes: (1) K provider identity and explicit intended-use rights; (2) published schema/encoding and documented update/retention/replacement policy; (3) source-issued immutable revision IDs or authenticated append-only event order; (4) independently authenticated inclusive completeness checkpoint and fork/tie policy; (5) terminality/post-final correction semantics, signed clock and key/revocation history; and (6) exact race/ticket/refund/void binding plus independent prospective cohort/protocol approval. A positive verified fixture cannot be constructed from the current documentation alone.

Falsifier: an authoritative K-provider specification and verifiable public test material establishing these properties, independently provisioned outside the caller request and reviewed for rights, would justify a new **read-only, synthetic-first** verification design. Until then, the correct outcome is **ENGINEERING_REQUIRED / UNRESOLVED_FINALITY**, with `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. Do not fetch bulk archives, activate N2, add a downloader, or connect to any production consumer on the basis of this audit.

## Authority, lineage and learning gate

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR #2286; prior head `a7b7f50f9787d0751b9475aacb527604201343f3`.
- Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; prior v349 source-finality and v350 official-source audits, v346 negative verifier fixture contract; `LEARN-forward-v02-settlement-revision-anchor-window-20261024`, `LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024`, `LEARN-forward-v02-negative-catalog-first-denial-precedence-20261026`, `LEARN-forward-v02-negative-catalog-case-semantics-drift-20261026`; `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`; merged PRs #2284 and #2285. Rejection registry has no substantive record. Historical dataset inventory is not prospective enrollment or independently authenticated terminality.
- `fingerprintKey=research-k3.forward-vault.v02-official-download-documentation-boundary-audit`
- `attemptSignature=pr2286-v351-read-only-K-index-official-retirement-policy-and-rights-boundary-review`
- `environmentKey=github-connector/public-official-web-text-extraction`
- `materialStateKey=forward-v02-pr2286-v350-K-archive-uninspected-no-authenticated-source-finality-or-usage-rights`
- Learning gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Existing terminal-revision and first-denial LEARN guardrails were reused; no unchanged failed method was retried. The zero-line K page extraction is a **bounded visibility limit**, not a newly diagnosed infrastructure/root-cause failure.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. This documentation/rights distinction is durable K4 research evidence, not a new independent verifier success or a distinct failure mechanism. No filler `LEARN-*` record.
- Previous PR-head CI #40267095402: verify and research-governance **SUCCESS** (4,507 pass / 2 skip / 0 fail). The present report needs a **new-head CI** before claiming its checks succeeded.

**Next safe action:** seek an issuer-authored K-specific documentation/terms/correction-history specification or a documented provider contact channel; if unavailable, stop at this explicit dependency rather than inventing source capabilities. No merge or scoring authority.
