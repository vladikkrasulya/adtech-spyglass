# Requirements Checklist: 030 Vendor carrier preview

- [x] Every requirement is stated as observable behaviour, not as an implementation instruction.
- [x] All three user stories are independently testable from the Inspector alone.
- [x] Every accepted vendor field name is traceable to the recorded provenance of a corpus case.
- [x] The sealed preview contract of 012 and the push qualification gate of DEF-203 are both
      explicitly preserved, and the preservation is asserted by tests rather than only claimed.
- [x] The blast radius of each new predicate was measured across the whole corpus before the code
      changed, and the measurement is kept as a standing test.
- [x] The one corrected expectation is carried by a decision record the owner can reverse.
- [x] The change touches no engine code.
- [x] Out-of-scope items are named: engine changes and automatic remote-asset inlining.
