# Requirements Checklist: 029 Preview carrier identity

- [x] Every requirement is stated as observable behaviour, not as an implementation instruction.
- [x] Both user stories are independently testable from the Inspector alone.
- [x] The sealed preview contract of 012 is explicitly preserved, and the preservation is asserted
      by the corpus rather than only claimed in prose.
- [x] The change touches no engine code, so it cannot collide with the peer-owned Core half of the
      same ledger record.
- [x] The alias contract has exactly one owner, and this feature reads it rather than restating it.
- [x] The blast radius of the new claim predicate was measured across the whole corpus before the
      code changed.
- [x] Corpus expectations state the specification-grounded target state, and ledger records list
      only what still deviates.
- [x] Out-of-scope items are named: Core format detection and automatic remote-asset inlining.
