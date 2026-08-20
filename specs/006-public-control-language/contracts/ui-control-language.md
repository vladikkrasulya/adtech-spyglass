# Contract: Public Control Language

## Role and State Contract

- A surface exposes at most one visually dominant action for its immediate job.
- Secondary, ghost, and destructive actions retain their semantic role across routes.
- Open disclosures visibly differ from closed disclosures without relying only on caret rotation.
- Disabled/busy controls remain visibly unavailable and do not retain live hover treatment.
- Focus-visible treatment is present for every keyboard-reachable interactive surface.

## Geometry Contract

- Standard control radius: 6 px.
- Popup/menu surface radius: 10 px.
- Phone popup horizontal gutter: at least 8 px.
- Supported responsive floor: 320 CSS px.
- Coarse-pointer contextual actions: at least 28 CSS px in each dimension.

## Accessibility Contract

- Visually actionable surfaces are native controls unless an equivalent semantic contract is
  necessary and complete.
- Form labels are programmatically associated with their controls.
- Disclosure panels use normal tab order rather than claiming unimplemented ARIA menu behavior.
- Modal/dialog focus enters the surface, stays contained where modal, closes on its supported Escape
  path, and returns to the original opener.
- Nested interactive controls and parent key handlers must not intercept a child button's action.

## Responsive Contract

- Inspector version and dialect values remain selectable on phones.
- Named result tabs scroll independently; More remains visible and its popup receives pointer input.
- Mobile Search has symmetrical gutters and keyboard-reachable starter suggestions.
- Mobile Streams shows Findings in the initial viewport without horizontal scrolling.
- Desktop Inspector and Streams retain their dense, aligned layouts.

## Locale and Theme Contract

- EN, UK, and RU expose equivalent actions and responsive reachability.
- Light and dark primary fills use a foreground/background pair with at least 4.5:1 text contrast.
- Account/About controls do not depend on route-local Inspector CSS.

## Exclusions

This contract does not change validation, Core/CLI interfaces, backend routes, storage, privacy,
authentication, or the separate OpenRTB compatibility assessment.
