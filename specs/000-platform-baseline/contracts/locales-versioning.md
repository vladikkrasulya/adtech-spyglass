# Contract: Locales and Versioning

**Owners**: localized routes and shells, browser/Core message catalogs, package manifests, and
version-consistency tests
**Supported product locales**: English (`en`), Ukrainian (`uk`), and Russian (`ru`)

## One Product in Three Locales

English, Ukrainian, and Russian are three presentations of the same product contract. A feature,
finding, route, control, privacy disclosure, or operational limitation that affects a user must keep
the same meaning in every applicable locale. Localization may adapt grammar and terminology; it must
not add a promise, remove a limitation, or change an authorization boundary.

The Ukrainian and Russian interfaces address one user informally in the singular. New text follows
that voice unless a surface intentionally addresses an organization or a group.

Українська проєктна термінологія: «вразливість / вразливості». Для security findings використовуємо
саме ці форми.

## Canonical URL Model

English is canonical without a locale prefix. Ukrainian uses `/uk` and Russian uses `/ru`; `/en`
forms redirect to the equivalent unprefixed English route. `lib/locale-routes.js` owns the allowlist,
canonicalization, localized shell selection, and real-404 boundary for application routes.

The route locale and `<html lang>` attribute are the browser UI source of truth. The `kt-lang`
cookie and the authenticated user's `preferred_locale` provide return-visit and cross-device
preference. Browser storage is a fallback for surfaces without a route-owned language attribute; it
does not create an alternative canonical URL scheme. A language change must navigate to the
equivalent canonical locale route and keep route meaning intact.

Blog URLs carry two distinct language concepts: the optional leading prefix is the UI locale, while
the `en|uk|ru` segment after `/blog/` is the post language. Cross-locale post routes are therefore
valid and must not be collapsed into one setting.

Route metadata, canonical URLs, indexability, hreflang, and locale availability follow the
[content and SEO contract](./content-seo.md). A translation that does not exist must not be advertised
as an available localized document.

## Text Ownership

Localized text has several deliberate owners:

- Core finding messages live in `packages/core/messages/{en,uk,ru}.json`; Core's missing-message
  fallback is Ukrainian, and a key absent from all catalogs renders visibly as a bracketed id.
- Shared browser chrome and cross-module strings live in `public/i18n.js`. Its runtime lookup uses
  the route-owned active locale and falls back to Ukrainian for a missing key.
- Lazy feature-specific browser strings live beside their feature in `public/modules/**/i18n.js` and
  register into the shared runtime catalog when that feature loads.
- Localized page shells and substantial static copy live in `public/index.{en,uk,ru}.html`,
  `public/about.{en,uk,ru}.html`, and `public/account.{en,uk,ru}.html`.
- The Inspector body lives in
  `public/modules/inspector/template.{en,uk,ru}.html`; its loader selects the active-locale template
  and falls back to English only if that asset cannot be loaded.
- Route metadata and programmatic landing copy live in their server-side SEO/landing registries;
  editorial Markdown owns its own declared language.

Do not copy a string into a second owner merely to make one screen pass. A new or changed user-facing
concept updates every applicable catalog/template and the tests that enforce catalog-key,
interpolation-token, route, or HTML parity. Interpolation tokens keep the same names across locales.
Missing text must remain visible during development rather than silently becoming an empty label.

## Independent Version Lines

The repository contains three independently versioned surfaces:

| Surface           | Current version | Source of truth              | Coupled repository surfaces                                        |
| ----------------- | --------------- | ---------------------------- | ------------------------------------------------------------------ |
| Web application   | `1.14.1`        | root `package.json`          | root lock metadata, `public/version.js`, and static HTML fallbacks |
| `@ortbtools/core` | `0.35.0`        | `packages/core/package.json` | its package-lock workspace metadata and documented Core contract   |
| `@ortbtools/cli`  | `0.1.1`         | `packages/cli/package.json`  | its package-lock workspace metadata and documented CLI contract    |

The app's browser display form is `v` followed by the root package version. `public/version.js`
paints that value into runtime markers. The no-JavaScript/static fallback in every localized About
page and Inspector template carries the same value, and `tests/version-consistency.test.js` fails an
incomplete bump.

Core and CLI versions do not follow the app version automatically. Their manifests and package-lock
workspace entries move only when the corresponding package contract changes. The workspace package
versions are repository truth, not proof of a registry release: neither package currently has a
verified npm publication. Installation claims remain absent until the explicit publish procedure is
completed and independently verified.

## Bump Rules

Each surface applies SemVer to its own public contract:

- **patch**: compatible correction or internal change with no new caller requirement;
- **minor**: backward-compatible capability or additive public behavior; and
- **major**: removal, incompatible shape/semantic change, or a newly required consumer migration.

A change can require bumps to more than one surface, but coupling is justified by affected
contracts, not by repository proximity. Finding additions are structurally additive but may alter
consumer verdicts, so their Core release impact is reviewed explicitly. Stable Core/CLI semantics
are defined in [the validator contract](./core-validator.md).

A version edit is one coherent change: update the owning manifest, relevant lock metadata,
user-visible/static surfaces, changelog or release communication where applicable, and regression
tests.

An application version change additionally requires its `CHANGELOG.md` entry, and that is enforced
rather than expected: `tests/changelog-completeness.test.js` fails when the newest `### vX.Y.Z`
heading is not the version `package.json` declares. Core and CLI version lines are recorded inside
the application entry that ships them rather than carrying headings of their own. The requirement is
enforced because it was previously only stated: five releases reached production with the file still
claiming its history was complete, because the version-consistency gate asks whether the version
surfaces agree with each other, never whether the release was written down. A version bump alone does not publish npm packages, create a Git tag/release, or deploy the
application. Those remain separately authorized actions under
[the release and deploy contract](./release-deploy.md).

## Required Verification

Locale changes run focused Core-message, browser-i18n, localized-route, localized-shell, and SEO
tests appropriate to the touched owner. Verify that keys and interpolation placeholders remain
usable in all three locales and that a language switch resolves to a canonical existing route.

Version changes run `tests/version-consistency.test.js` and `tests/changelog-completeness.test.js`
plus the relevant Core/CLI API and package smoke tests. Before merge, run the complete repository gate from [the baseline quickstart](../quickstart.md).

## Change Rule

A supported-locale, fallback, canonical-prefix, preference, text-owner, voice, terminology, or
version-surface change updates this contract and its enforcement tests in the same feature. New
localizable UI must name its text owner and cannot ship with one locale silently omitted.
