# Design evidence

Decision: remove viewport-based font enlargement and constrain the desktop grid. The prior 1600/2800 breakpoints grow body and editor text; a separate later rule grows findings to 17/19px. The shell cancels the original 2200px cap. Fixed type and bounded panels address the reported cause directly.

Alternatives considered: browser zoom would change user preference and conceal the CSS cause; capping only finding text would leave stretched card borders; a new visual system would be unrelated scope. Existing colors and font families need no replacement.
