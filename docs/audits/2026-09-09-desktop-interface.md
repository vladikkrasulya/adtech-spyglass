# Desktop interface audit — 2026-09-09

**Historical snapshot** of this maintenance pass. Current behavior is owned by the
[platform baseline](../../specs/000-platform-baseline/plan.md); active work is tracked
in the [roadmap](../../specs/ROADMAP.md).

The owner requested a visual consistency pass with desktop as the primary target,
including saved examples, common desktop resolutions, ultrawide displays, and
125%/150% scaling. The baseline was the live v1.20.0 image `ortbtools:76570e4`
on `vkbox`; changes were developed against `f01fbd2`, its release-record commit.
This maintenance pass ships as app 1.20.1; Core and CLI contracts are unchanged.

## Visual requirements and corrections

| Surface                              | Observed defect                                                                         | Corrected behavior                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Account recent examples              | Undefined `--fs-xs` made metadata inherit 15px body text                                | 13px interface titles and 11px monospace metadata, matching Samples; long titles remain contained |
| Account                              | Guest heading inherited 80px marketing type; cards used 28px headings and 40px counters | Guest heading 28px desktop, card headings 20px, counters 28px; localized descriptions 13px        |
| Saved examples in Inspector          | Human titles used the wider monospace face                                              | Interface typeface at the same 13px size                                                          |
| History drawer                       | Status pill could protrude; every non-error status looked successful                    | Metadata wraps; warnings, errors/invalid, clean and unknown states have distinct semantic styling |
| Article body                         | Markdown headings inherited 80px/40px defaults larger than the article title            | Explicit 28/20/17/15px h1–h4 hierarchy and bounded spacing                                        |
| Samples, Streams, Dialects, Insights | Tables and overview content stretched beyond 3200px                                     | Shared 1800px content limit; aligned header/filter/table gutters and 20px section headings        |
| Selection and dialect expiry         | Text used foreground colors intended for opaque fills                                   | Theme-aware readable selection ink and warning text                                               |
| Compact Inspector window             | At 721–1023px, content exceeded the viewport but document scrolling stayed locked       | Document scroll begins at the same 1024px boundary as the shell; footer reachable by wheel        |

The existing Inspector 2200px workbench limit and documentation/article reading
widths retain their distinct purposes. The vendored design system is untouched.
Module styles are removed on route deactivation; the initially suspected
persistent Inspector CSS leak was not present in this version.

## Desktop verification

Direct entry and in-app navigation were exercised for Inspector, Samples, Streams,
Dialects, Insights, Docs and Blog using real Chrome with the application running
against a fresh temporary data directory. Populated Inspector/history views used
public synthetic payloads. Account and article regressions used explicit synthetic
API fixtures through the real renderers; no production account records were read.

| Viewport in CSS pixels | Coverage                        |
| ---------------------- | ------------------------------- |
| 1280×720, 1366×768     | Smaller desktop/laptop windows  |
| 1440×900, 1536×864     | Common logical desktop sizes    |
| 1920×1080              | Full HD                         |
| 2560×1440              | QHD and effective 4K at 150%    |
| 3440×1440              | Ultrawide                       |
| 3840×2160              | 4K                              |
| 1093×614, 911×512      | Effective 1366×768 at 125%/150% |
| 3072×1728              | Effective 4K at 125%            |

Scaling coverage uses the corresponding reduced CSS viewport, not a claim that
physical monitor diagonals or operating-system font rasterization were tested.
The focused account/article regression covers EN/UK/RU and both themes; dark
section screenshots and populated Inspector states were also inspected.

The final route matrix had no browser exceptions, document horizontal overflow,
or clipped controls. The compact Docs navigation is intentionally horizontally
scrollable within its own container. Streams may contain different row counts
between visits because its public preview is dynamic.

## Reproducible regression gate

`tests/interface-typography-browser.test.js` verifies rendered account typography,
long-title containment, article hierarchy, history status colors, and real wheel
access to the Inspector footer in a compact desktop window. Run it with
`CHROME_BIN` set to the installed Chrome executable. Set `ORTBTOOLS_UI_ARTIFACTS`
to save representative account and article screenshots.

Focused version, control, account, type-scale and blog checks passed. The existing
Inspector density and mobile browser suites passed. Full repository and hosted
release gates are recorded separately in the delivery evidence.
