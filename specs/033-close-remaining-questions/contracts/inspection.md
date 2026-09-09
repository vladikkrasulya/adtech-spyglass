# Inspection contracts

## Existing analysis

`POST /api/analyze` may accept an additive `declaredRoute` object `{adapterId,direction,revision,provenance:'declared'}` and an additive `declaredSender` object `{asi,sid,provenance:'declared'}`. Type/size validation is bounded and raw bodies remain transient. Existing findings/sides/crosscheck and default behavior retain compatibility except explicit source-backed SChain corrections. Additive route relevance explains declared profile applicability; absent/unknown/incompatible context is explicitly unknown. It cannot select a profile from free-form labels or imply actual routing.

## Bounded inspection module

- `GET /api/inspection/profiles`: bounded pinned public profile metadata including adapter identity, supported direction, revision and source references. No account or traffic data.
- `POST /api/inspection/schain`: accepts `{input,declaredSender?,locale?}` for structured/raw-serialized/explicit-query inspection, with existing bounded JSON input and human-paste limiter. Returns parsed kind, chain copies/locations, node counts, findings and comparison provenance. It never fetches the supplied URL or constructs a fictional auction.

Core exposes pure inspection and declared-route evaluation functions used by these handlers. Public action UI uses the existing modal/lifecycle pattern, shows input kind, source/count/finding meaning, and retains visible unknown/unsupported states. All three locales are mandatory. Caller field spelling and returned fields must be finalized with executable HTTP/Core contract tests before UI consumption.

Declared-route carrier traversal shares a10000-value budget across statements/aliases and a32-level nesting cap. Non-object impression entries and exhausted traversal bounds yield `unknown/incompatible_input`, including cyclic direct-Core inputs. The evaluator does not traverse unrelated extension subtrees.

## Mapping API

Mapping create/edit adds `match_scope` (`value` default or `path`), with normalized exact path semantics. Path scope accepts only nine role labels, persists no representative observed value and roundtrips row version2. Unsupported scope/version/label and duplicate-path conflicts are explicit errors. Scope edits, delete, default-dialect activation and cache invalidation are account-scoped. Exact mappings win. Import schema2 is atomic and explicit; legacy schema1 remains exact.

## Asset action

One explicit signed-in resource batch per current creative. Manifest shows hosts/roles/limits; use existing raster endpoint/SSRF controls. Individual failure and retry are visible. No automatic fetch, broadened sandbox/CSP, remote code/CSS/fonts/media fetch, payload persistence or forwarding of browser credentials. Preserve full document styling and current probe/static-source identity.
