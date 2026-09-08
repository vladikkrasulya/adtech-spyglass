# Implementation Plan: Vendor request dialects and Core recognition

**Branch**: `codex/028-vendor-request-dialects` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/028-vendor-request-dialects/spec.md`.

## Summary

Add narrow vendor owners and URL decoders, integrate them through existing Core dispatch/format boundaries and only the necessary backend analysis calls, then reduce proven layer deviations. Keep recognition separate from validity and unsupported status. Use one delivery wave unless verification establishes a useful independent split; each delivered wave receives its own settled local and hosted gates.

## Technical Context

**Language/Version**: JavaScript, CommonJS Core, Node.js >=22.13.0; JSDoc type checking.

**Primary Dependencies**: Existing workspace Core/CLI, `node:http`, canonical decoder helpers and project test tools; no new runtime dependency.

**Storage**: No new storage; analysis remains transient.

**Testing**: `node:test`, unchanged 256-case Core/HTTP/browser corpus, existing public-boundary tests, Prettier, ESLint, typecheck, package/version and managed SpecKit gates.

**Target Platform**: Node server and browser-consumable Core; public preview implementation is separately owned.

**Project Type**: Existing library/CLI/backend application.

**Performance Goals**: Bounded linear carrier/query inspection with finite malformed-input probes; no recursive data expansion, asynchronous work or external I/O in Core.

**Constraints**: Preserve public IDs/order/deduplication, original input paths, raw query values, strict OpenRTB economics, current sandbox and all public file ownership.

**Scale/Scope**: Five groups/24 cases plus five supplemental 026 Native recognition cases; all 256 cases form the impact boundary.

## Constitution Check

| Principle             | Design gate                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I: Spec Kit memory    | Constitution, roadmap and relevant contracts read before requirements; spec/plan/checklist/tasks and read-only analysis precede runtime. Publish package and ignored pointer only in the isolated verified-main worktree. |
| II: Evidence          | Primary documents are cached with hashes; recognition, validation, provisional status and all-layer closure are distinct. Two Kadam assertions and peer preview contradictions are explicitly gated.                      |
| III: Privacy/security | No payload logging/persistence, model forwarding, runtime network, credentials or sandbox changes; tracked records contain no private paths or raw payload bodies.                                                        |
| IV: Compatibility     | Additive finding IDs with locale/ref tests; stable shapes/order/dedup/CLI policy, structural IAB precedence and public regression coverage.                                                                               |
| V: Architecture       | Existing owner modules and decoder registry, no new framework/service/store/global facade. Shared role tables are extracted from their owner.                                                                             |
| VI: Locales           | Every additive user-facing finding moves in en/uk/ru; public rendering wording remains the peer's responsibility.                                                                                                         |
| VII: Verification     | Narrow red/green public probes, full corpus comparison, independent browser evidence, then required CI/package/governance gates; no unrun pass claims.                                                                    |
| VIII: Delivery        | Core 0.46.0/CLI range/lock reconciled after integration; explicit file staging and non-force branch push after gates; no deployment or publication claim.                                                                 |

No constitution exception is requested. Post-design review uses these same gates; later implementation must record actual outcomes separately.

## Project Structure

### Documentation (this feature)

```text
specs/028-vendor-request-dialects/
  spec.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  tasks.md
  contracts/vendor-inspection.md
  checklists/requirements.md
```

### Source Code (repository root)

```text
packages/core/
  vendor-exads.js
  vendor-adon3.js
  decoders/request/{index.js,url-exads-feed/,url-ppcmate-feed/,url-kadam-feed/,url-adon3-feed/}
  {detect.js,index.js,rules-feed.js,rules-request-url.js,format-detect.js,crosscheck.js}
  dialects/inpage-push.js
  messages/{en,uk,ru}.json
  spec-refs.json
modules/analyze/handler.js
tests/
  vendor-exads-validation.test.js
  vendor-url-decoders.test.js
  vendor-adon3-inspection.test.js
  vendor-format-recognition.test.js
  vendor-http-boundary.test.js
  corpus/{pairs,mutations}/
```

**Structure Decision**: EXADS and Adon3 owners contain shared recognition/field roles; thin decoders project GET inputs through existing helpers. Existing dispatch, format and analysis consumers import those owners. File names are implementation targets, not claims that modules already exist. No `public/` path is an implementation target.

## Phases and ownership

1. **Setup and frozen evidence**: Read back verified main, all 29 cases and full 256-case baseline. Publish this package and set the ignored pointer. Record the two Kadam assertion decision and peer dependencies without broadening scope.
2. **Documented carriers**: EXADS owner and PPCmate/Kadam decoders can be developed in disjoint files after shared interfaces are agreed. The decoder owner alone edits the decoder registry and URL validation; the integration owner alone edits the detector, Core index, feed rules and format detector. Add negative public probes before each integration.
3. **Format and provisional inspection**: Add project inpage and nested AdCOM Native recognition using owning helpers. Implement explicit Adon3 inspection warning and preservation rules. The integration owner serializes shared dispatch/format/catalog changes; independent tests may run separately.
4. **Parity and ledger**: Exercise Core and real HTTP, ensure recognized proprietary crosscheck behavior agrees while malformed IAB controls still fail appropriately, compare all 256 cases, then narrow proven Core/HTTP signatures and measured repaired Core-derived browser lines while retaining all unresolved preview signatures. Browser checks are observations, not permission to edit public. Retire an individual whole record only with a complete browser pass.
5. **Delivery**: Update as-built baseline contracts and version surfaces, run targeted browser layer with Chrome namespace isolation before the final local gate, run `npm run ci`, review/stage exact files, commit and push once per settled wave, then record hosted CI against the pushed SHA.

## Interface and compatibility decisions

- EXADS functions live in `vendor-exads.js`; detectors distinguish the carrier from IAB while validators retain original `bid.*` paths. URL requests retain the public `URL Request` result and existing `urlRequest` envelope.
- Adon3-shaped request metadata carries `contractStatus: provisional-unsupported`; request and response both emit an additive public WARNING. Recognition labels describe the carrier, never successful certification. No source version is upgraded from provisional.
- The VENDOR_REQUEST constant and vendor validation type labels are additive; their display meaning and warning delivery must work through the existing backend response. Existing types are not renamed.
- Request field presence establishes a family attempt; semantic validation independently diagnoses omission, blank values and invalid types. HTTP(S), path/key families and existing decoder protections bound recognition. Generic/malformed IAB markers win over vendor heuristics.
- Request format declarations are authoritative evidence, with response evidence retained where meaningful. Kadam Native is explicit; undisclosed push/inpage provisioning is not inferred. AdCOM Native does not turn every display wrapper into banner.
- EXADS response field omissions without primary required markers receive, at most, documented product guidance; supplied malformed values remain errors. The conflicting EXADS `sub` length prose/examples do not justify a hard length error.
- Core crosscheck exclusion is narrowly tied to recognized proprietary carriers. If the existing handler still diverges, change `modules/analyze/handler.js` to consume that shared classification rather than copy its signature rules.
- 022 effective-floor ownership, strict finite numeric OpenRTB prices, 3.0 `{cur}` projection, 023 bounded XML handling and 026 Native/media checks remain untouched except an independently demonstrated required integration call.

## Verification and decisions

The [contract](./contracts/vendor-inspection.md) defines source mappings, provisional status and ledger rules. [Research](./research.md) records the two pending Kadam assertions, four peer-owned DEF-180 contradictions and independent preview tails. A denied or unanswered Kadam correction preserves its exact expected-failure signature; it does not authorize a substitute oracle.

The browser runner's current command and counters are the authority. Use `unshare` isolation according to the existing project recipe and record the actual namespace/server settings in machine-local evidence. No payloads/private absolute paths enter tracked records. Spec/plan/task coverage analysis is a prerequisite to releasing runtime work; convergence follows implementation and verification.

## Complexity Tracking

No additional framework, service, database or cross-cutting abstraction is required. Shared vendor owners replace duplicated shape/role checks at existing boundaries.
