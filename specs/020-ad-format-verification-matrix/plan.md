# Implementation Plan: Ad format verification matrix

**Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

## Summary

Recover Opus's isolated corpus harness, import the independently sourced 38-case archive, harden the oracle, exercise existing Core/HTTP/Inspector paths, and publish bounded coverage plus separate defect and cleanup evidence. Runtime fixes are follow-up scope.

## Technical Context

JavaScript CommonJS, Node >=22.13, existing node:test, puppeteer-core and Chromium; existing HTTP server with temporary isolated data. No new dependencies. Local generated media and image assets are served by request interception without changing product CSP. Repository baseline a61fc258c3ec8cc8bda5e2512df125a358bc08a4; App 1.19.4, Core 0.38.0.

## Constitution Check

Pass before and after design: baseline Core/HTTP/frontend contracts read; synthetic fixture bodies reside only in tests; spec records contain no traffic payloads; no live production data or external ad execution; no sandbox policy changes, new dependencies or runtime contract changes; tests follow existing runner and required CI. Existing untracked Opus files are continued, not discarded. No unresolved clarification or hook (extensions.yml hooks is empty).

## Project Structure

- tests/corpus/{pairs,mutations,assets}/: attributed fixtures and local assets.
- tests/corpus/known-gaps.json: exact, evidenced deviations.
- tests/corpus/lib/: schema, loader, patcher, oracle, Core/HTTP/browser drivers, report and importer.
- tests/corpus-*.test.js: normal discovery plus focused harness, Core, HTTP, browser and UX tests.
- scripts/corpus-matrix.js and scripts/run-corpus.js: reports and isolated full audit.
- specs/020-ad-format-verification-matrix/: governance, coverage, verification, defects and cleanup backlog.

## Execution

Foundation contracts precede parallel corpus, oracle and browser work. Root owns HTTP/report/integration. Corpus author owns pair/mutation/assets and DEF-100–199; browser-only gaps use DEF-200–299 coordinated with ledger owner. Core owner owns schema/loader/oracle/patcher and their focused tests. Browser processes run serially. Integrate focused tests before full CI; report known deviations separately from passing normative assertions. No automatic retry in the dedicated audit.

## Complexity Tracking

No new framework or service. One original portable archive is retained outside the repository, with hash/provenance and extracted local assets in the test corpus. Normalized files keep individual cases reviewable.

## Coverage closure — 2026-09-08

Reopen the existing feature after the user rejected the remaining 52 pairwise gaps. First review applicability independently, then add source-grounded protocol/context/dialect, standalone-input and preview edge cases. Root owns preview fixtures, harness/report changes and integration; parallel authors own disjoint new fixture paths and ledger shards. Retain normative assertions when recording exact known deviations. Browser execution remains serial. Add a coverage regression guard, run focused layers and the complete audit/CI, regenerate matrices and the portable export, and reconcile completion against FR-010/SC-005.
