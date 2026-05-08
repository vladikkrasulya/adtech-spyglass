# Spyglass Knowledge Base

Curated reference fixtures for OpenRTB and JsonFeed payloads, organized by
spec version, side, and ad format.

## Why this exists

Spyglass already ships TYPE detection (`detectType` → request/response/feed)
and VERSION detection (`detectVersion` → 2.5 / 2.6 / 3.0). What was missing
is FORMAT detection — answering "is this a banner, a VAST in-stream video,
an audio podcast slot, a native card, a CTV reward video, a vendor push feed?"

The Knowledge Base is the data layer that supports two derived features:

1. **Format Detection Engine** (`packages/core/format-detect.js`) —
   pure-data heuristics. Runs in browser AND Node, no fs reads.
   Returns `{ formats, contexts, protocols, tags, confidence }`.

2. **Smart LLM Context (Few-Shot)** (Phase 10b — wired in
   `intel-llm.js`) — when the local LLM is asked to name a discovered
   dialect cluster, we inject 1–3 anonymized field-list examples drawn
   from this base, so the model answers in the vocabulary of the real
   market rather than from priors alone.

The KB is reference data, not test fixtures. `tests/fixtures.js` exists
for unit tests and stays separate.

## Layout

```
knowledge_base/
├── manifest.json                   # index of every sample (id, file, tags, source)
├── SOURCES.md                      # provenance + collection plan
├── ortb-2.5/
│   ├── request/{banner,video,audio,native,inapp}/
│   └── response/{banner,video,audio,native,inapp}/
├── ortb-2.6/
│   ├── request/{banner,video,audio,native,inapp,dooh}/
│   └── response/{banner,video,audio,native,inapp,dooh}/
└── jsonfeed/
    ├── push/                       # vendor-style push notification feed
    ├── pops/                       # popunder / clickunder
    └── inpage/                     # in-page native widget
```

Each format folder holds `*.json` payloads. Metadata lives in
`manifest.json`, NOT in the JSON files themselves — keeping payloads
drop-in valid (you can copy any sample straight into the inspector and
it parses cleanly).

## Adding a sample

1. Drop the JSON into the matching folder (or create it).
2. Append an entry to `manifest.json`:

```jsonc
{
  "id": "ortb26-req-video-ctv-rewarded-001",
  "spec": "ortb-2.6",
  "side": "request",
  "format": "video",
  "tags": ["ctv", "rewarded", "vast-4"],
  "file": "ortb-2.6/request/video/ctv-rewarded.json",
  "source": "synthesized from IAB 2.6 §3.2.7 (rwdd) + §5.30 (mtype)",
  "license": "MIT (Spyglass)",
  "description": "CTV rewarded VAST 4 video, mtype-tagged response pair",
}
```

3. Rules for hand-curation:
   - **Self-contained** — no `$ref`, no env vars, no placeholders.
   - **Minimal but realistic** — only fields needed to demonstrate the
     format; NEVER include real `buyeruid`, `ifa`, `ip`, consent strings,
     or anything that could fingerprint a real user.
   - **License-clean** — only synthesized samples or samples from
     MIT / Apache-2.0 / CC-BY upstream sources (see `SOURCES.md`).
   - **Versioned** — version-specific fields (e.g. `mtype`, `rwdd`,
     `dooh`) belong in `ortb-2.6/`, not `ortb-2.5/`.

## What's NOT here

- Real production traffic (privacy floor is "no real bidstream samples").
- Vendor-proprietary extensions outside their declared dialect.
- Negative / malformed fixtures — those live in `tests/fixtures.js`.
