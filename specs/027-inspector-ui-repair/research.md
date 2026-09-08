# Phase 0 Research: Inspector UI Repair

**Date**: 2026-09-08. Written alongside the retroactive package; every claim below was measured
against the shipped code, not recalled.

## R1. Where each defect lived

- **DEF-200**: `runAnalysis()` had two failure paths. The network-throw path called
  `clearResultsForError()`; the structured path (`!r.ok || j.success === false`) only raised a toast,
  leaving `window.__ortbtoolsLast`, the verdict and the preview from the previous success on screen.
- **DEF-205**: provenance was `reqVal === _prettyPrintedReq ? _rawBeforePretty : reqVal`. Any paste
  that happened to equal the last pretty-print therefore reported findings against superseded bytes.
- **DEF-260**: both iframe creation sites set `sandbox` and nothing else — no `title`, no
  `aria-label`.
- **DEF-201**: the bid was resolved inline as `seatbid[0].bid[0]`, with no addressable alternative.
- **DEF-202/203**: `findPushMaterial()` looked only at the response itself or as an array, and
  qualified on any creative-ish key, so documented wrappers were invisible and a text-only PPCmate
  pop was dressed as a notification card.
- **DEF-245**: nothing detected a redirect-script pop at all.

## R2. Push qualification (decision, and a correction)

**Decision**: a material is a push notification when it carries a price key, a click key, a visual
asset, and notification identity — text (`title`/`description`) **or** an explicit push-material id
(`tId`).

The first attempt required a visual asset **and** text. That broke 014 FR-005, which renders
icon-only and image-only materials; the gate caught it. Dropping the text requirement then broke two
tests asserting the opposite: a vendor banner bid (EXADS `res.bid` with `imgUrl`/`clickUrl`/`btype`,
no notification fields) must not be dressed as a card.

Both tests were right. The real discriminator is not text but notification identity: the 014
fixtures carry `tId` even when they carry no title, and the EXADS banner carries neither. Requiring
a visual asset keeps DEF-203's PPCmate pop out; requiring identity keeps the banner out.

## R3. Reaching later creatives (decision)

**Decision**: resolve any seat/bid pair or feed material from `window.__ortbtoolsLast` and repaint,
rather than re-posting. The stored analysis already holds the parsed request and response, so
selection is a pure client-side projection with no new network surface and no new server contract.

The selector renders only when more than one candidate exists, so a single-bid response is unchanged.

## R4. What the corpus measurement demanded

Identity is proven from inside a **visible** iframe (body text, image alt, decoded image src) or,
when no iframe is visible, from the outer inert text. That asymmetry is why DEF-245's caption does
not register: the caption is built and appended, but the measurement does not reach it in the
configuration the fix produces. The detection half is verified working on all four fixtures; the
display half is not. Recorded as open.

## R5. Boundaries this feature did not cross

The sealed frame policy is untouched. Remote images stay refused; materials the selector newly
exposes therefore render partially, which is declared per creative rather than hidden behind a
retired record.
