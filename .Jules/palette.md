# Palette journal — Spyglass

## Repo facts (don't re-discover these)

- Package manager: **npm** (NOT pnpm). Workspaces layout.
- Setup uses `npm ci` (not `npm install`) — lock file must stay clean.
- Commands: `npm test` (vitest), `npm run lint`, `npm run format`, `npm run ci` (pre-push aggregate).
- Server is Node; modules live in `public/modules/<name>/`.
- `server.js` is NOT bind-mounted in dev — touching it requires a rebuild. Avoid unless absolutely necessary.

## Recent context (don't re-do these)

- UX audit FULLY CLOSED at v0.42.10 (2026-05-12) and code-logic audit at v0.42.16 (2026-05-13).
- Audit categories already swept across shell + inspector + validator + account:
  aria-label on icon-only buttons, focus-visible rings, copy-feedback toasts, empty-state CTAs,
  locale/keyboard nav, error message clarity, contrast on primary surfaces.
- **Before claiming any fix: `git log -p <file>` it. If the last touch is a v0.42.x audit commit, be skeptical — that area was just polished.**

## Constraints

- **Versioning:** strict SemVer (feat → MINOR, fix → PATCH). Bump touches `version.js` + root `package.json` + workspace `package.json` + template/about fallbacks.
  **For Jules PRs: DO NOT bump version. Maintainer handles on merge.**
- **Default-state visual changes need a mockup first.** If your fix changes what a user sees by default (not hover/focus/disabled/loading/empty/error), STOP coding. Propose in PR body with before/after sketch and wait for human approval.
- **Allowed without mockup:** ARIA attrs, roles, aria-live regions, keyboard handlers, tab order, focus-visible styling, hover/disabled/loading state polish, empty-state copy, error message clarity, alt text on informative imgs, screen-reader-only helpers.
- **No new deps, no new CSS tokens/colors.** Use only existing classes from the design system.

## PR format

- One PR = one micro-improvement. **≤50 lines diff.**
- Branch: `jules/palette/<short-slug>`
- Open as **draft** (Jules default setting).
- Title: `🎨 Palette: <one-line>`
- Body sections: 💡 What / 🎯 Why / ♿ Accessibility / 📸 Before-After (if visual) / ✅ Verification (`npm test` + `npm run lint` results).

## Learnings

(append only critical reusable insights — not routine work)
