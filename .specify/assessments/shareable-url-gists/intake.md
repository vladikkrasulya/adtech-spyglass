# Idea Intake: Shareable URL Gists

- **Slug**: shareable-url-gists
- **Created**: 2026-08-12
- **Source**: Discussion in AI chat assistant session (pasted text)
- **Type**: new-capability

## Idea (as captured)

> **Проблема:** Зараз розробники чи QA експортують бандли через export.js (JSON-файли) і пересилають їх у Slack/Jira.
> **Покращення:** Додати кнопку "Share". Вона зберігатиме BidRequest/Response на сервері (можливо, з шифруванням або терміном дії 7 днів) і генеруватиме коротке посилання. Це дозволить миттєво скинути лінк партнеру: "Ось ваш запит, подивіться на помилку валідації у полі crid".

## Restated

Add a "Share" feature that saves the current BidRequest/Response payload to the server and generates a short, shareable link. This replaces the need to download and manually share exported JSON bundles.

## Origin & Context

- **Raised by**: AI Assistant (suggested based on product context) and approved by the User.
- **Trigger**: User requested ideas for functional improvements that would make the product more convenient for end users.

## First-Glance Unknowns

- [NEEDS CLARIFICATION: Where will the shared payloads be stored? (SQLite, Redis, S3?)]
- [NEEDS CLARIFICATION: Should the shared data be encrypted at rest, and who holds the decryption key?]
- [NEEDS CLARIFICATION: What is the exact retention policy for these shared links (e.g. 7 days, 30 days)?]
- [NEEDS CLARIFICATION: Will generating a link require authentication, or can anonymous users share payloads?]
