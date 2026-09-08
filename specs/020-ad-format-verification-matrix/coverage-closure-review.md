# Coverage applicability review — 2026-09-08

The earlier 52 gaps were overlapping pairwise cells: protocol 7, context 10,
dialect 3, standalone scenario 8, preview kind 14, rendered state 8 and media
state 2. They were not 52 failed tests or 52 independent scenarios. Presence of
a case and measured product conformance remain separate.

## Corrected preview projections

The [preview contract](../012-creative-preview-repair/contracts/creative-preview.md)
classifies the selected body independently of the requested ad format. Its
sections 1–2 render markup and synthetic Native cards in a sandbox and show
other bodies as inert text. Invalid or mismatched markup still needs its
independent validation assertions; correct inert display does not validate a bid.

- Inpage markup is applicable: the existing `inpage-x-widget-adm-and-ext` case
  already exercised it, but the report incorrectly called that cell N/A.
- Video markup may produce full or partial visible HTML. The absence of a VAST
  player excludes VAST playback, not the HTML display branch. Audio full/partial
  remains excluded for the enumerated VAST/DAAST, empty and unidentified carriers.
- Push and inpage unidentified bodies can be nonempty inert text, so those
  rendered-state cells are applicable.
- Pop and inpage markup can contain media elements refused by the sealed
  `media-src 'none'` policy. Their `mediaPlays: no` cells are applicable. `no`
  also includes inert VAST without a media element; it does not claim readiness.

The kind table is an explicitly bounded set of normal carriers and selected
malformed/mismatched-body probes. Other N/A kind cells are outside that bounded
projection, not impossible input values. Arbitrary malformed combinations and
every possible vendor carrier are not exhaustively enumerated. Unit checks now
reject an excluded cell or triple that nevertheless contains a corpus case.

Implementation evidence: `public/modules/inspector/creative-classify.js`
`classifyOnce`; `public/ortbtools.app.js` `setAdPreview`, `renderNativeToHtml`,
`renderPushToHtml` and `buildProbedSrcdoc`; `tests/corpus/lib/browser.js`
`measurePreview` keeps rendered state and playback separate.

## Standard protocol/context triples

[OpenRTB 2.5 §3.2.1](https://iabtechlab.com/wp-content/uploads/2016/07/OpenRTB-API-Specification-Version-2-5-FINAL.pdf)
defines Site/App distribution fields, without a standard DOOH object.
[OpenRTB 2.6 §3.2.32 and change log](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectdooh)
introduce the DOOH object. Therefore the four format × 2.5 × DOOH rows remain
visible as N/A for this standard-wire-context projection. This does not deny
historical vendor extension implementations; those need their own source and
extension-specific assertions.

[AdCOM Dooh and Appendix C Request Context](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md#object_dooh)
define Dooh as a distribution channel and map context objects under the OpenRTB
3.0 request context. Thus 3.0 DOOH stays applicable for banner/video/audio/native;
the 3.0 fixture uses `request.context.dooh`, with AdCOM fields such as `venue`,
`fixed` and `etime`. CTV uses `request.context.device.type`, rather than the
2.x `device.devicetype` spelling. Absent context remains applicable: AdCOM
Appendix C explicitly makes the top-level context objects optional. All 60
standard triples remain listed, including the four justified exclusions.

This review expands applicable preview coverage; it does not close remaining
cells by relabelling them. Fresh cases and measured outcomes are required for
the final closure report.
