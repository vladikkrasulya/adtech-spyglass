# ADR-014: Default Locale Becomes English

**Status**: Accepted
**Date**: 2026-08-27

## Context

`server.js:78` sets `const DEFAULT_LOCALE = 'uk';`. `resolveLocale()` (server.js, ~line 940) uses
this value whenever a request's `?locale=` query parameter is absent or names a locale the server
does not support:

```js
function resolveLocale(parsed) {
  const want = parsed.searchParams.get('locale');
  if (want && listLocales().includes(want)) return want;
  return DEFAULT_LOCALE;
}
```

`resolveLocale` feeds `POST /api/analyze` and its siblings (wired at server.js lines ~997, 1007,
1028). An integrator who omits `?locale=` — which nothing in the HTTP API documentation requires
them to set — silently receives Ukrainian finding text today.

This is the one place the codebase's own canonical-locale convention is not applied. Everywhere
else that makes a default-locale choice already treats English as canonical:

- `public/core/routes.js:41` — `export const DEFAULT_LOCALE = 'en';`, with a header comment
  stating "en is the CANONICAL NO-PREFIX locale."
- `packages/core/categories.js:26` — `const DEFAULT_LOCALE = 'en';`.
- The platform's [locales-and-versioning contract](../000-platform-baseline/contracts/locales-versioning.md)
  states English is canonical without a URL prefix, with Ukrainian and Russian as the prefixed
  locales.

`docs/i18n-audit-2026-08-27.md`'s `locale-plumbing` finding for `server.js:78` names this
directly as "contradicting the canonical-en convention used elsewhere in the same codebase," and
[015-trilingual-output-parity](../015-trilingual-output-parity/spec.md) FR-008 requires the
change as part of closing systemic cause (b) — both fallback chains defaulting to Ukrainian for
every locale, including English.

## Decision

Change `server.js:78` from `const DEFAULT_LOCALE = 'uk';` to `const DEFAULT_LOCALE = 'en';`.

`resolveLocale()`'s behavior for a present, valid `?locale=` parameter is unchanged — this
decision affects only the value returned when the parameter is absent or invalid.

This is a **breaking change to a public contract** (Constitution Principle IV): an integrator
calling `POST /api/analyze` (or any other route through `resolveLocale()`) without `?locale=`
currently receives Ukrainian finding text and will receive English finding text after this
change ships. There is no version negotiation and no deprecation window — the response body's
language changes for any caller relying on the undocumented default.

## Alternatives Considered

- **Keep `'uk'`.** Rejected: it is the one place in the codebase that contradicts its own
  canonical-locale convention (`public/core/routes.js`, `packages/core/categories.js`, the
  locales-and-versioning contract all agree English is canonical-no-prefix), and it is a silent
  trap — an integrator who never sets `?locale=` has no signal they are receiving a
  non-English response at all. Leaving it as-is preserves a contract nobody documented on
  purpose.
- **Add a transitional response header** (e.g. `X-Default-Locale-Changed: true` or echoing the
  resolved locale for one or more releases before flipping the default) so existing integrators
  get a machine-readable warning before the value itself changes. Rejected for this decision: the
  HTTP API has no versioning scheme to attach a deprecation window to, no known external
  integrator inventory exists to notify, and the audit's own severity classing treats "an
  English-locale visitor silently receiving Ukrainian" as the higher-severity defect to close
  now rather than defer behind a transition. The maintainer may still choose to add a resolved-
  locale response header as a _general_ API-quality improvement (echoing the effective locale
  regardless of which one is default) — that is a separate, un-decided idea and not a
  precondition for this change.
- **Echo the resolved locale in every response regardless of default value**, so the "what
  language did I get" question is answered without inspecting the body. Rejected as a
  precondition for _this_ ADR for the same reason as the transitional-header alternative — it is
  a genuinely good, separate improvement, not part of closing the specific silent-uk-default
  defect this decision addresses.

## Consequences

- English becomes the canonical default everywhere in the codebase, with no remaining exception.
  `server.js`'s `DEFAULT_LOCALE` now agrees with `public/core/routes.js:41` and
  `packages/core/categories.js:26`.
- Any existing integrator who depends on the undocumented uk-by-default behavior (never having
  set `?locale=`) sees their response language change from Ukrainian to English on the release
  that ships this. `docs/api-v1.md` (the public HTTP API documentation, out of the
  015-trilingual-output-parity package's file ownership) should be checked for whether it
  documents a default at all, and updated if it does, as a follow-up outside this decision's
  scope.
- No code path that already sends an explicit `?locale=uk` or `?locale=ru` is affected.
- The browser application's own route-based locale resolution (`public/core/routes.js`,
  `lib/locale-routes.js`) is untouched — this ADR is about the server's query-parameter default
  for API-style calls, not about which localized page a browser visitor lands on.

## Related Artifacts

- [015 Trilingual output parity](../015-trilingual-output-parity/spec.md) — FR-008, systemic
  cause (b)
- [`docs/i18n-audit-2026-08-27.md`](../../docs/i18n-audit-2026-08-27.md) — `locale-plumbing`
  finding, `server.js:78`
- [Locales and versioning contract](../000-platform-baseline/contracts/locales-versioning.md)
- `server.js` (`DEFAULT_LOCALE`, `resolveLocale()`), `public/core/routes.js`
  (`DEFAULT_LOCALE`), `packages/core/categories.js` (`DEFAULT_LOCALE`)
