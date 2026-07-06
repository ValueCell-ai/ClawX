# Light Neutral Theme Design

## Goal

Replace ClawX's warm cream-based light theme with a white and neutral-gray palette inspired by the Codex desktop app reference. The dark theme must remain visually and token-wise unchanged.

## Scope

This is a token-first theme update with small supporting cleanup.

In scope:

- Update light-mode CSS color tokens in `src/styles/globals.css`.
- Keep the `.dark` token block unchanged.
- Update comments and token documentation that describe the light palette as cream or warm paper.
- Add or update E2E coverage for the light theme palette and dark-theme preservation.

Out of scope:

- Broad component restyling.
- Layout changes to match the Codex reference.
- Typography, spacing, or interaction redesigns.
- Changes to user-facing copy or i18n files.

## Current State

Light-mode colors are centralized in `src/styles/globals.css`. The relevant tokens are:

- `--background`: warm cream page background.
- `--surface-modal`: lifted cream surface for cards, dialogs, popovers, and inputs.
- `--surface-input`: recessed cream surface for code panes, segmented tracks, and inset fields.
- `--surface-sidebar`: warm sidebar surface.

`tailwind.config.js` maps these variables to `bg-background`, `bg-surface-modal`, `bg-surface-input`, and `bg-surface-sidebar`. Most components already consume those utilities, so the implementation can avoid component-by-component restyling.

Dark mode defines its own neutral deep-gray token block under `.dark`. The surface tokens already redirect to dark semantic values there and should not be changed.

## Proposed Palette Direction

Use neutral HSL values with very low or zero saturation:

- App background: near-white neutral gray.
- Raised surfaces: white or almost white.
- Recessed/input surfaces: light neutral gray, slightly darker than the app background.
- Sidebar surface: neutral gray rail that remains distinct from the main content without looking beige.
- Border, input, muted, and accent tokens may stay on the existing shadcn neutral scale unless visual checks show they still read warm.

The visual target is clean, white/gray, and restrained rather than pixel-perfect Codex mimicry.

## Implementation Design

Make the smallest correct change:

1. Update light-mode token values in `src/styles/globals.css`.
2. Rewrite nearby comments from cream/warm-paper terminology to neutral surface terminology.
3. Update the component convention comments that currently describe `bg-surface-modal` and `bg-surface-input` as cream surfaces.
4. Update `tailwind.config.js` comments for the surface token group from cream-paper language to neutral layer language.
5. Review only obvious hard-coded light-mode assumptions discovered during implementation. Change them only if they directly contradict the new palette.

No renderer logic, API calls, or i18n behavior should change.

## Testing

Add or update Electron E2E coverage because this is a user-visible UI change.

The test should verify:

- In light mode, computed colors for core app surfaces resolve to white or neutral gray rather than warm cream.
- In dark mode, the same core token values still resolve to the existing dark neutral colors.

Run at minimum:

- `pnpm run typecheck`
- The relevant E2E spec for the new theme assertion

If the E2E harness is too expensive or blocked locally, record the blocker and still run the fastest available validation.

## Documentation

Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` after implementation. The current theming docs are generic and likely do not need changes unless implementation changes user-visible behavior beyond the palette.

## Risks

- Some components may rely on subtle warmth for contrast. Token values should preserve enough layer separation between background, raised surfaces, recessed surfaces, and sidebar.
- Visual regression may appear in Monaco diff backgrounds because light diff editor backgrounds are explicitly tied to `--background`.
- Comments in design-token docs must stay accurate so future contributors do not keep following cream-theme guidance.

## Approval

User approved the token-first neutralization approach with small cleanup on 2026-07-06.
