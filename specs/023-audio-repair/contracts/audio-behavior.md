# Contract: Audio Detection, Findings and Preview

**Version decision**: Core `0.40.0` → `0.42.0`; CLI remains `0.1.3` with Core dependency `^0.42.0`; application remains `1.19.4`. Workspace lock metadata must agree. These are repository versions, not registry publication or deployment claims.

## Additive findings

| ID                         | Level | Path                    | Condition                                                      |
| -------------------------- | ----- | ----------------------- | -------------------------------------------------------------- |
| `imp.audio.mimes_required` | error | `imp[i].audio.mimes`    | Missing, non-array or empty MIME array on an audio impression. |
| `imp.audio.mimes_invalid`  | error | `imp[i].audio.mimes[m]` | Nonempty array contains a non-string or blank string element.  |

Both IDs require en/uk/ru messages and OpenRTB Audio field references in `packages/core/spec-refs.json`. Valid nonempty string arrays produce neither new error. This is type/presence validation, not a registry of every valid MIME type. The adopted VAST media whitelist separately accepts its supported audio MIME variants.

## Detection compatibility

- `detectFormat` retains its formats/contexts/protocols/tags/confidence shape. Existing findings and stable sort/dedup semantics remain.
- In OpenRTB 2.x responses, audio-only actual media does not manufacture a video signal; actual video remains visible even alongside audio metadata. Mixed evidence can produce both formats.
- Actual quoted XML attributes contribute evidence; markup-looking text in another value, comment, CDATA or DOCTYPE does not. Malformed parsing terminates without inventing a valid attribute; no entity resolution or network calls occur.
- OpenRTB protocol codes 9/10 map to DAAST; 7/8/11–14 map to VAST4; existing VAST2 and VAST3 families retain their corresponding inline/wrapper codes. Code4 does not become DAAST. AdCOM response ctype is scalar; malformed arrays add no ctype protocol evidence.
- Existing exports and CLI exit codes remain. Newly added errors may make the default CLI threshold return1 for malformed audio inputs; that is the existing policy applied to additive findings, not a changed exit-code contract.

## Preview and corpus compatibility

Actual DAAST roots, including supported namespace/prolog forms, use the existing inert `vast` text preview kind. A DAAST prefix on a different local root is not a DAAST document. The shared caption names an ad XML document rather than claiming video or VAST for every document. No script/media execution, wrapper fetching, sandbox expansion or playback promise is added.

Only DEF-101/112/102 retire. Preserve the 17 original payloads and normative expectations, with 16 fully normative cases and `audio-web-26-multi-imp-reversed` retaining browser DEF-201. All other exact known-gap guards remain. Thirty-seven groups is the audio snapshot count; concurrent feature integration must recompute rather than overwrite a peer's ledger changes.
