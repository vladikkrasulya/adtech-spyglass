# Idea Intake: Local Model Maximum v3

- **Slug**: local-model-maximum
- **Created**: 2026-08-23
- **Source**: pasted text (owner, 2026-08-23) — a work package titled "Завдання для Fable5: Local
  Model Maximum v3", handed over after three days of local-model measurement and an external audit
  of that measurement on the same day
- **Type**: improvement (research tooling and operational hardening; zero product surface, on the
  same footing as feature 008 research D2)

## Idea (as captured)

The owner's framing, quoted from the work package (Ukrainian original, condensed to the load-bearing
lines; the full package is the session record of 2026-08-23):

> Мета: витиснути максимум із локальних `gemma4-prod` 8B і `gemma4:31b`, піднявши якість через
> чисту онтологію, відтворюваний benchmark, вузький кодовий контекст, детерміновану перевірку та
> розумну ескалацію.
>
> Цільовий конвеєр: Go AST/call graph → candidate bundles → 8B витягує атомарні факти →
> детермінована перевірка й класифікація → незалежний 31B review лише для неоднозначного → human
> queue для нерозв'язаного.
>
> Межі: не переписувати завершену історію feature 008; окремий assessment/spec з наступним вільним
> ID; не завантажувати й не видаляти моделі до завершення чесного baseline; не змінювати canonical
> corpus автоматично — лише migration proposal та human-reviewed diff; не використовувати зовнішні
> LLM/API; не передавати shared GPU runner-level параметри на кшталт `num_ctx`; не перезаписувати
> старі runs; не друкувати secrets.
>
> P0 — спочатку відтворюваність (спільний benchmark runner, що зберігає промпт, схему, options,
> сирий response з thinking, хеші, latency cold/warm, scorer output, manifest і replay; `think`
> явно; accuracy тричі). P0 — прибрати операційний борг (`gemma4:e4b` у executable defaults;
> процедура retirement; `keep_alive:0` з перевіркою RAM). P1 — taxonomy v3 як одне джерело правди
> (факти, не disposition; `conditional` окрема вісь; legacy disposition з versioned decision table;
> `unclassified/escalate` замість здогаду; з одного taxonomy — prompt, JSON Schema, docs,
> classifier, boundary fixtures). P1 — чесний benchmark (364 verified rules у 84 adapters як seed;
> adapter-disjoint tune/dev/sealed-holdout ≈ 60/20/20; ≥100 triage-кейсів family-disjoint; метрики
> precision/recall/macro-F1, citation resolvability, hallucination rate, escalation). P1 — prompt v3
> і candidate miner (go/parser + go/types + bounded call graph; 2–8k токенів замість усього adapter;
> `analysis_status=partial` → escalate). P1 — двоконтурний router (8B facts → code checks → 31B
> незалежне читання без label 8B → compare → human queue; cache key = model digest + taxonomy hash +
> prompt hash + candidate hash + options). P2 — оптимізація по одній змінній, тричі, тільки на tune.
>
> Definition of Done: accepted outputs 100% schema-valid; citations resolvable 100%,
> evidence-supported ≥95%; candidate recall ≥95%, критичні drop/reject/forbidden — 100%; extraction
> micro P/R ≥0.90; macro-F1 ≥0.85 і ≥+10 п.п. проти prompt-v2 baseline; нуль critical false
> negatives; router відстає від always-31B ≤1 п.п.; 31B escalation ≤20–25%; compute ≤30% від
> always-31B; triage macro-F1 ≥0.95, schema-validity 100%, false-safe = 0; hot 8B p50 не гірший
> поточного більш ніж на 20%; executable defaults без `gemma4:e4b`; fast і deep smoke зелені, deep
> runner після роботи відсутній у RAM; production, Steam guard і canonical corpus не регресували.
>
> Якщо ворота не пройдені — не оголошувати успіх і не auto-apply результати.

## Restated

The owner proposes a research-tooling programme that raises the measured quality of the two local
models already on the host — not by changing models, but by replacing the nine-word disposition
guess with a fact-based taxonomy, by making every measurement reproducible and immutable, by
feeding the model narrow AST-mined code bundles instead of whole adapters, and by routing only
objectively ambiguous cases to the slower 31B tier. It also closes a small operational debt left by
the model retirement of 2026-08-23. Success is defined by explicit numeric gates; failing a gate
means reporting the failure with an error taxonomy, not declaring success.

## Origin & Context

- **Raised by**: the owner, in the session of 2026-08-23, after accepting an external audit of the
  preceding three days of measurement.
- **Trigger**: the measurement showed that a prompt rewrite (v1 → v2) more than doubled extraction
  accuracy on both models while a 4× larger model added nothing — and the audit established that
  the remaining misses trace to an inconsistent taxonomy (`moved`/`rewritten`/`injected` overlap;
  `imp/dropped` contradicted by a "parsing is boilerplate" instruction; `conditional` treated as a
  disposition rather than an axis), to a non-reproducible bench (no raw responses, no hashes, no
  holdout, recall-only scoring), and to retired-tag defaults still present in executable code. Seven
  disposition disagreements from feature 008 remain in a named follow-up queue and sit on the same
  taxonomy boundaries.
- **Related governance**: feature 008 (complete; its history is not to be rewritten), ADR-005
  (evidence-driven dialects), ADR-012 (bounded model assist — product paths; this idea has zero
  product surface and does not reopen it), the dialect-direction pause recorded in
  `specs/ROADMAP.md` on 2026-08-22.

## First-Glance Unknowns

- [NEEDS CLARIFICATION: the 364 verified rules were produced under taxonomy v1; how many survive
  re-verification under a fact schema, and is the remaining gold large enough for a 60/20/20
  adapter-disjoint split with every disposition present in each split?]
- [NEEDS CLARIFICATION: candidate-miner recall is the upstream ceiling for everything downstream —
  what recall does a go/types + bounded-call-graph miner actually reach on the verified rules before
  SSA is considered?]
- [NEEDS CLARIFICATION: can the seven 008 disagreements be resolved by the v3 decision table alone,
  or do some require facts the miner cannot observe (cross-function flow, reflection)?]
- [NEEDS CLARIFICATION: which of the Definition-of-Done gates are reachable on a bench of this size,
  and which are aspirational — macro-F1 ≥0.85 over nine classes with five `forbidden` examples in
  the whole corpus may not be measurable at all?]
- [NEEDS CLARIFICATION: where do the runner, taxonomy, miner and router live — feature 008 placed
  the lab outside the repository (research D2); does this package keep that placement, and what
  then is tracked in the repository beyond the spec package?]
