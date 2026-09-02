# Quickstart: Validating the Vendor Ext-Key Role Alphabet

**Feature**: [016](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-28

How to prove this feature works, in the order the evidence should be produced. Every command below
is runnable from the repository root. Implementation belongs in `tasks.md`; this is the validation
guide.

---

## Prerequisites

- Node.js `>=22.13.0`.
- For the manifest and oracle checks: **nothing else**. They are pure and run in CI.
- For the calibration bench only: the out-of-tree research corpus is _not_ needed, but the shared
  host model is — check it is resident before spending time on it:

```bash
curl -s --max-time 4 http://localhost:11434/api/tags | head -c 200
```

- For regenerating the manifests only (maintainer operation): the corpus at
  `~/.local/share/ortbtools-research/`.

---

## 1. Manifests are internally consistent — no corpus required

The first thing to run, and the check that must never depend on out-of-tree material.

```bash
node --test tests/key-role-manifests.test.js
```

**Expected**: 322 corpus records; partition 194 / 33 / 95; adjudication covers exactly the same set
with two recorded review passes each; every `resolved` score reproduces from its evidence; named
rules match the frozen oracles; all pinned digests present. See
[contracts/manifests.md](./contracts/manifests.md).

---

## 2. Exact-case identity holds

```bash
node --test tests/key-role-alphabet.test.js
```

**Expected**: a lookup for a listed spelling resolves; a lookup for a _differently cased_ spelling
**abstains** rather than inheriting the listed entry. This is the invariant the existing resolver's
`toLowerCase()` derivation would break, and the corpus's 22 collision buckets are why it matters.

---

## 3. Every row of the precedence matrix

```bash
node --test tests/key-role-precedence.test.js
```

**Expected**: each row of the spec's precedence table asserted independently. The two rows that
matter most:

- `popunder = 1` still resolves to `pop` through the terminal-flag path, whatever the role layer
  says. This is the regression that a naive "numeric ⇒ custom" reorder would have caused.
- A role-layer `abstain` over a `broad-heuristic` legacy verdict **preserves the legacy answer** and
  does not call the model. No signal that is deterministic today becomes a model call.

---

## 4. The 14 frozen scenarios and the ceiling oracle

```bash
node --test tests/key-role-oracle.test.js
```

**Expected**: all fourteen scenarios return the exact role, projected label, `valueStatus`, exact
confidence and route the spec freezes. Spot-checks worth reading in the output:

| Signal         | Role                 | Label         | Confidence | Route    |
| -------------- | -------------------- | ------------- | ---------- | -------- |
| `ad_type = 30` | `format-declaration` | `custom`      | `0.90`     | no model |
| `subage = 18`  | `measurement`        | `measurement` | `0.90`     | no model |
| `format = 12`  | `format-declaration` | `custom`      | `0.40`     | no model |
| `limit = 1`    | — (ambiguous)        | none          | none       | no model |
| `mode = 2`     | — (abstain)          | —             | `0–0.30`   | model    |

Plus the claim-aware ceiling pair: `publisher_account_ref = 42` and `= "acct-42"` both accept a
replayed `identifier @ 0.70` **unchanged**. If either is clamped to `0.30`, FR-008 is not met.

`publisher_account_ref` is a negative control — the test asserts it is absent from the corpus, the
named rules, saved mappings and legacy rules before using it.

---

## 4b. The routing matrix — coverage, D0 vs D1, route counts

```bash
node --test tests/key-role-routing-matrix.test.js
```

**Expected**: a fixture for every adjudication partition across all 322 names, every named rule, all
47 spellings in the 22 collision groups, an unlisted-casing control and an absent-key control in both
namespaces. The run prints five route counts separately — `exact-format`, `role-resolved`,
`role-ambiguous`, `preserved-legacy`, `model` — and asserts:

- `D1 > D0`, and
- **no fixture that was deterministic in `D0` reaches the model in `D1`.**

`D0` is committed data captured against pre-change code. If it is regenerated after the resolver
changes, this step proves nothing.

---

## 4c. The model prompt gained no field

```bash
node --test tests/key-role-privacy-boundary.test.js
```

**Expected**: the prompt payload sent to the model contains exactly the signal path, the value, the
redacted impression sketch and sibling key names — the ADR-012 §6 allowlist, unchanged. The
impression-shape verdict is present in the local explanation and in `evidence[]`, and **absent** from
the prompt. `git diff docs/PRIVACY.md` is empty for this feature.

---

## 5. Compatibility floor

```bash
node --test tests/dialects.test.js tests/ai-label.test.js
```

**Expected**: every pre-existing label stores, reads back and behaves exactly as before (FR-021,
SC-010); the nine new labels are accepted by the save route; the `ambiguous` variant is served and
carries no preselected label; format recognition consults the explicit `FORMAT_LABELS` allowlist and
treats all nine new roles as inert.

---

## 6. Locale parity

```bash
node --test tests/i18n-audit.test.js tests/model-free-contract.test.js
```

**Expected**: all twenty labels carry a display name and description in en/uk/ru; the ambiguity copy
exists in all three; the model-free contract still holds — the role layer is deterministic and opens
no new model reachability.

The browser mirror is gated separately, because the no-bundler picker cannot import Core:

```bash
node --test tests/key-role-browser-mirror.test.js
```

**Expected**: `public/core/key-role-vocabulary.js` is set-equal to Core's `STORABLE_LABELS` and the
display catalog. Drift is a build failure, not a runtime surprise.

For Story 4, the locale repair needs its own assertion: a low-evidence signal requested at
`locale: ru` returns Russian prose with no Ukrainian fragments. **The calibration bench cannot see
this** — it never inspects the answer's language, which is exactly how 015 reported "identical
before/after" while the breach survived.

---

## 7. Full gate

```bash
npm run ci
```

**Expected**: `format:check`, `lint`, `typecheck` (`tsc --noEmit` with `checkJs` — new exports need
JSDoc types) and `test:coverage` all green, exit 0.

> A browser CDP flake (`Protocol error … Promise was collected`) can appear when another Chrome is
> running on the host. Re-run the single browser test in isolation to distinguish it from a real
> failure. Never bypass the gate.

---

## 8. Calibration bench — maintainer operation, before and after

Not a CI gate: it needs a live host model (ADR-012).

```bash
node scripts/label-calibration.js
```

Run it **before** the persona edit and **after**, and record both. Two things to watch:

- Any revised band must be revised deliberately and recorded (FR-011). The `counter` case's floor of
  `0.4` currently sits above the persona's `0.3` ceiling — that contradiction is what this feature
  removes, so its revision is expected and must be written down, not quietly absorbed.
- The bench skips whatever the deterministic layer resolves. As the alphabet grows, the bench's
  population **shrinks**. That is correct, and it means a green bench proves less than it used to —
  the 14-scenario oracle in step 4 is what carries those cases now.

---

## 9. End-to-end, by hand

With the app running, paste the redacted synthetic replica of the Kadam→Admobex push request and
open the finding for `imp[0].ext.ad_type`.

**Expected**: the answer names the role, says separately that the code `30` is vendor-private,
shows that it came from a table with its citation and verification status, and offers a form where
the role is supplied and only the value is the operator's to decide. The scope warning names this
dialect, this path and this exact value.

**Never expected, in any locale, at any confidence**: a specific ad format named on the strength of
`30` alone.
