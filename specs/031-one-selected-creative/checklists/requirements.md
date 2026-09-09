# Requirements Checklist: 031 One selected creative

- [x] Every requirement is stated as observable behaviour, not as an implementation instruction.
- [x] Both reported defects were reproduced independently, on payloads written here, before any fix.
- [x] Each defect has a regression that fails for the right reason before the change and passes
      after it, at the real browser boundary.
- [x] The currency regression is an existing, previously green, conformant case — proving the corpus
      was blind rather than the case missing.
- [x] The consequence of unifying the two resolution copies was measured across every materialized
      response before the unification, and each difference was judged individually.
- [x] The one behaviour change beyond the reported defects is stated as a requirement and pinned by
      corpus assertions.
- [x] The sealed preview contract and the push qualification gate are both preserved.
- [x] A guard that claims corpus-wide reach now sweeps the whole corpus and every material, and says
      so truthfully.
- [x] No engine code is touched.
