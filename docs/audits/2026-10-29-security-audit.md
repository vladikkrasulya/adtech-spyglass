# Security audit — 2026-10-29

**Historical snapshot** of one audit pass over the public deployment. Current behavior is owned by
the [platform baseline](../../specs/000-platform-baseline/plan.md); open work and ordering are
tracked in the [roadmap](../../specs/ROADMAP.md). This file records what was examined, what was
found and how each finding was disposed of; it contains no production data, addresses or secrets.

## Scope and method

Examined at commit `145cec9` (the live image, v1.23.0 plus the first three audit fixes), read-only:

- dependency advisories: `npm audit` (production and development), outdated packages;
- image and filesystem scan: Trivy `0.76.1`, `image` and `fs`, severities CRITICAL and HIGH;
- secrets in history: gitleaks over every ref (772 commits);
- code review of the attack surface: sessions and cookies, rate limits, operator endpoints and the
  `ADMIN_STATS_TOKEN` gate, request-body limits and parsers, SSRF surfaces (creative asset, outbound
  proxy), static serving, security headers, ClickHouse query construction, storage growth, GitHub
  Actions and repository settings;
- black-box probes of a throw-away local server (no production traffic): malformed paths and
  bodies against every route, 2 MiB payload shapes for parser cost, reflection and redirect probes,
  storage-growth and lockout behavior.

The earlier same-day audit (public-mode behavior, rate-limit bucket, proxy IP leak, login CSRF,
account deletion) is a separate record and is not repeated here.

## Result in one table

| ID  | Severity | Finding                                                                                       | Disposition                                    |
| --- | -------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| H1  | High     | Unauthenticated SQL injection in `GET /api/v1/blog/list` (`lang`, `category`)                 | Fixed — PR `fix/blog-list-sqli`                |
| H2  | High     | Unbounded storage growth: anonymous share links and every signed-in library write             | Fixed — PR `fix/storage-quotas`                |
| H3  | High     | One address can monopolise the single event loop with maximal analysis bodies                 | Fixed (budget) — PR `fix/http-robustness`      |
| D1  | Critical | DOMPurify advisory GHSA-cg2g-xh64-v4q7 in the vendored browser copy (3.4.14)                  | Fixed — PR `fix/deps-and-image`; not reachable |
| D2  | High     | 13 CRITICAL/HIGH Trivy findings, all inside the base image's bundled npm tree                 | Fixed — PR `fix/deps-and-image`; not reachable |
| M1  | Medium   | Operator token compared with `!==`, no lockout (200 wrong guesses all answered 401)           | Fixed — PR `fix/http-robustness`               |
| M2  | Medium   | Anonymous 500s (and error reports) from malformed percent-encoding and NUL bytes in paths     | Fixed — PR `fix/http-robustness`               |
| M3  | Medium   | Blog list response cache keyed by request parameters, never evicted                           | Fixed — PR `fix/blog-list-sqli`                |
| M4  | Medium   | Asset fetch limited by an idle timeout only; a slow-drip host held a socket indefinitely      | Fixed — PR `fix/http-robustness`               |
| M5  | Medium   | `readJson` counted UTF-16 units against a byte cap and decoded chunks separately              | Fixed — PR `fix/http-robustness`               |
| M6  | Medium   | JSON `null`/array body crashed two authenticated handlers (500)                               | Fixed — PR `fix/http-robustness`               |
| M7  | Medium   | Workflow actions pinned to movable tags; checkout persisted the job token; no dependency gate | Fixed — PR `ci/pin-actions-and-audit`          |
| M8  | Medium   | Runtime container kept all Linux capabilities and had no process cap                          | Fixed in compose — in effect since 2026-10-30  |

Both D-class items were verified unreachable (the renderer's DOMPurify configuration does not use
the affected options; `node server.js` never loads npm) and are recorded as hygiene, not as an
exploited hole. Nothing was exploited against the live service.

H1 is the finding to understand. The blog list interpolated `lang` and `category` into a ClickHouse
query after removing single quotes. ClickHouse also honours a backslash escape, so `lang=\` consumed
the template's closing quote and the following parameter became raw SQL. The route is public and the
application's ClickHouse account is effectively an administrator (see "ClickHouse account" below).
The fix whitelists both parameters and escapes the rest with `chEsc`; an invalid filter skips the
query. The regression test fails on the old code.

## Open findings (not fixed in code)

| ID  | Severity | Finding                                                                                                                 | Next step                                                       |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| O1  | Medium   | CSP `script-src`/`style-src` still allow `'unsafe-inline'`                                                              | Needs its own spec; blocked by creative `iframe.srcdoc`         |
| O2  | Medium   | ClickHouse account `ortbtools` can manage access and grant                                                              | Done 2026-10-30: `ortbtools_app`, `docs/OPERATIONS.md` §4.11    |
| O3  | Medium   | Registration is open and does not require a confirmed email                                                             | Gate library writes on a verified address, or add a challenge   |
| O4  | Medium   | Dialect labeller has a per-user rate limit but no in-flight cap; the CPU-only runner serialises                         | Add a global in-flight cap (returns 429/503)                    |
| O5  | Medium   | Outbound proxy re-checks the hostname allow-list but not the resolved address (DNS rebinding)                           | Pin to the validated address like `lib/asset-fetch.js`          |
| O6  | Medium   | Repository is public; secret scanning, push protection and Dependabot alerts are disabled; `main` is unprotected        | Done 2026-10-30: all enabled; `main` needs a PR and green `ci`  |
| O7  | Low      | Account deletion cannot purge ClickHouse if it is unreachable; rows then age out by TTL (90/180 d)                      | Retry queue; see roadmap                                        |
| O8  | Low      | `npm publish` runs without provenance                                                                                   | Add `id-token: write` and `--provenance` when publishing starts |
| O9  | Low      | Session cookie lacks the `__Host-` prefix; per-account login lockout allows deliberate lockout                          | Document or rename on next auth change                          |
| O10 | Low      | Oversized bodies are drained rather than cut (documented trade-off); no explicit Node timeouts or connection cap        | Set `requestTimeout`/`headersTimeout`/`maxConnections`          |
| O11 | Low      | Unauthenticated error-ingest tunnel (`/glitchtip-ingest/*`) lets anyone write events into the error tracker (60/min/IP) | Accept, or require a signed header                              |
| O12 | Low      | `extra_hosts: host.docker.internal:host-gateway` gives the container a route to host services                           | Remove if nothing uses it                                       |
| O13 | Low      | No Cloudflare-side rate/WAF rule is part of the repository's documented setup                                           | Document the edge rules; the CPU budget is origin-side only     |

## ClickHouse account

**Resolved 2026-10-30:** the application now runs as the restricted account `ortbtools_app`; the
old account stays for maintenance only (`docs/OPERATIONS.md` §4.11). The text below describes the
state at the time of the audit.

The application uses one ClickHouse account for everything. In the live deployment that account
has `ACCESS MANAGEMENT` and `GRANT OPTION`, so any query injection (H1 was one) or a leaked
password is a full database takeover, including creating other users. The application needs far
less: inserts into five tables, selects from the same tables, `ALTER UPDATE` on `blog_drafts` and a
lightweight `DELETE` on the two tables that carry `user_id`. The least-privilege plan, the grants,
the profile, the verification and the rollback are in `docs/OPERATIONS.md` §4.11. The application
needed no code change for it.

## Secrets and history

gitleaks reported two matches across 772 commits; both are fixture constants in unit tests
(`tests/site-auth.test.js`, `tests/auth-event-pii.test.js`). No credential has been committed.
Trivy `fs` reported no vulnerable package in the lockfile; its only HIGH misconfiguration findings
are inside a vendored dependency's own Dockerfile under `node_modules`, which is not built.

## What was not verified

- Browser tests (they need Chromium; CI runs them).
- Cloudflare edge configuration, and any behavior of the live ClickHouse: H1 was demonstrated by
  reading the query construction and a stubbed-ClickHouse regression test, not against the live
  database.
- Effect of the container and image changes (they apply at the next build and recreate).
