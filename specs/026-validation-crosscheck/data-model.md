# Data Model: Validation Semantics

No stored schema, network contract or persistence is added. The entities are transient views of supplied auction data.

| Entity                  | Relevant fields                                                                                     | Relationship and validation                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Request auction         | 2.x `imp`, `wseat`, `bseat`, `regs.coppa`; existing 3.0 envelope                                    | Impression lookup remains ID-based; explicit seat constraints compare supplied identities; supplied COPPA is integer 0/1. |
| Offered media           | `banner`, `video`, `audio`, `native`; AdCOM placement forms                                         | Media alternatives remain alternatives; constraints apply to the selected compatible family.                              |
| Response seat           | `seatbid[].seat` and child bids                                                                     | Repeated explicit identities across groups are diagnosable; multiple bids in one group are allowed.                       |
| Bid declaration         | `impid`, optional `mtype`, existing price/deal fields                                               | `mtype` is integer 1–4 if supplied; preserve exact price/deal-floor semantics from 022.                                   |
| Creative representation | Nonblank `adm`, supported `native` object, supported notice URL; AdCOM display Native               | Presence does not bypass content/type validation; no remote creative retrieval.                                           |
| Inline media evidence   | VAST/DAAST kind, actual MediaFiles, MIME, duration/protocol, Linear/NonLinear structure             | Ignore metadata-like text; multiple renditions are alternatives; absent evidence never invents a compatible fact.         |
| Native assets           | Required asset identities, supported asset content and request constraints                          | Equivalent supported representations share the applicable completeness semantics.                                         |
| Finding                 | `id`, `level`, `path`, `params`, `specRef`, localized `msg`; crosscheck also `ok`/optional `detail` | Existing finalization, filtering, deduplication and ordering remain. New IDs are additive public keys.                    |
| Deviation signature     | Group, case, layer, exact admitted deviation                                                        | Resolved signatures retire only with normative evidence; unrelated residual signatures keep attribution.                  |

The only lifecycle change is evidence state: reproduced deviation → verified repair → reviewed retirement → locally gated commit → pushed branch → hosted gate result. Main integration and deployment are separate maintainer-controlled states.
