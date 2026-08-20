# Data Model: Public Control Language

This feature creates no database entity, migration, payload field, account record, or telemetry
event. The relevant state is transient presentation state already owned by browser controls.

## Control Role

- **Roles**: primary, secondary, destructive, ghost, selection, disclosure trigger.
- **States**: default, hover, focus-visible, disabled, busy/loading, open/expanded.
- **Invariant**: a role keeps the same consequence and hierarchy across routes and themes.

## Disclosure State

- **Owner**: the native disclosure element or an existing module-owned expanded state.
- **Attributes**: open/closed, trigger, controlled panel, current focus owner.
- **Transitions**:
  - closed → open: panel becomes visible and trigger reflects open state;
  - open → closed: panel becomes unavailable and focus returns to the trigger when closure moves it;
  - route/unmount: disclosure closes and listeners are cleaned up by the existing module lifecycle.

## Responsive Presentation

- **Inputs**: viewport width, locale-specific label length, pointer capability, available panel space.
- **Outputs**: compact labels/settings disclosure, popup direction and bounds, visible stream columns,
  scrollable named tabs.
- **Invariant**: presentation may change, but the user's available jobs and selected values do not.

## Persistence

Existing theme, locale, dialect, version, and navigation preferences keep their current storage
owners and formats. No new persistence or data lifecycle is introduced.
