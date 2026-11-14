---
version: alpha
name: ClawX
description: A warm, task-first desktop AI workspace with readable compact controls and restrained visual layers.
---

# ClawX Design System

## Overview

This is the project-wide design contract for application UI. Read it before
designing, implementing or reviewing a UI change. It applies to every page and
shared component, including new features. Existing inconsistencies are work to
converge, not alternative standards to copy.

This document follows the [Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md).
YAML blocks define exact tokens; prose explains their visual role and application.
The format is alpha. ClawX's visual choices are its own, independent of the
upstream specification's example palettes and typefaces.

Think of a desktop task workspace: a calm navigation rail, one clear place to
start a task, and files or results that appear beside the conversation as needed.
Content and the next useful action lead the eye. Settings and configuration use
the same visual language as the conversation instead of resembling a separate
administration console.

The core direction is **clear compact operation, comfortable reading, quiet
chrome, and restrained color in content and feedback**. A readable interface can
feel light without shrinking its important text. Small colored skill icons and
meaningful feedback bring personality while the surrounding structure stays calm.

### Project ownership

- **This document** defines visual roles, values and usage rules. Keep one
  project-wide standard instead of inventing a scale for each component.
- **[AGENTS.md](AGENTS.md)** requires contributors and AI agents to follow it and
  defines engineering and validation workflows.
- **[tailwind.config.js](tailwind.config.js)** implements font families, size
  tokens and semantic color mappings.
- **[globals.css](src/styles/globals.css)** implements theme variables, shared
  styling and motion. Its substitution table explains implementation idioms.
- **[src/components/ui](src/components/ui)** implements shared interaction and
  presentation defaults. Product components compose these defaults.

When changing a design rule, update this document and the affected token or
shared implementation together. Remove superseded guidance instead of leaving
competing rules in comments, AGENTS.md or Harness specs. Task reports and old
screenshots are historical evidence; they do not override this contract.

### Baseline and rollout

The text roles and usage rules below are the agreed target for new and touched UI,
not a claim that every existing page already conforms. The palette is a snapshot
of the current theme, and the spacing/radius values reuse existing scales.
Extracting a value from code does not establish its quality: known issues remain
explicit below and must be checked in context before extending the baseline.

### Visual hierarchy

ClawX should feel approachable, calm and responsive. Use warm neutral surfaces,
restrained blue accents and clear content hierarchy. Preserve comfortable reading
sizes while keeping controls compact.

- Give each page one primary heading and a short, useful subtitle where needed.
  Keep page headings, action placement and gutters consistent across sections.
- Use whitespace, alignment and typography to group content. Add a border,
  surface or container only when it communicates a meaningful boundary. Avoid
  stacks of cards, repeated header rows and single-option sub-navigation.
- Tabs already identify the active view. Put useful explanatory copy beneath
  them without repeating the same title and icon as another heading.
- Keep primary actions easy to find. Two compact actions can be visible together;
  an overflow menu is for genuine overflow, not a default hiding place.
- Preserve raw skill names/descriptions, provider labels, model IDs and protocol
  names. Localize surrounding interface text and keep instructions concise.

## Colors

```yaml
colors:
  primary: "hsl(221.2 83.2% 53.3%)"
  primary-action: "hsl(221.2 83.2% 53.3%)"
  primary-action-hover: "hsl(224.3 76.3% 48%)"
  message-user: "hsl(221.2 83.2% 53.3%)"
  on-primary: "hsl(210 40% 98%)"
  foreground: "hsl(225 23% 15%)"
  muted-foreground: "hsl(220 10% 44%)"
  background: "hsl(40 20% 98.5%)"
  surface-modal: "hsl(0 0% 100%)"
  surface-input: "hsl(35 14% 96%)"
  surface-sidebar: "hsl(35 12% 95%)"
  border: "hsl(220 13% 89%)"
  primary-dark: "hsl(217.2 91.2% 59.8%)"
  primary-action-dark: "hsl(221.2 83.2% 53.3%)"
  on-primary-dark: "hsl(210 40% 98%)"
  foreground-dark: "hsl(210 20% 96%)"
  muted-foreground-dark: "hsl(220 8% 72%)"
  background-dark: "hsl(240 4% 11%)"
  surface-modal-dark: "hsl(240 3% 14%)"
  surface-input-dark: "hsl(240 3% 18%)"
  surface-sidebar-dark: "hsl(240 4% 11%)"
  border-dark: "hsl(240 3% 24%)"
```

The warm near-white canvas makes the lifted white composer, dialogs and popups
feel distinct without surrounding everything with a card. Blue identifies the
main action or selection. Dark mode preserves these roles using the `-dark`
palette; it does not invert colors mechanically. These values mirror the
existing theme. Additional status and content-specific accents remain defined
in `globals.css`.

Keep brand blue for primary actions and selection, with small, purposeful accents
in skills and status feedback. Secondary text must stay readable against its
actual surface. Its position and tone can communicate lower priority without
reducing every description to a tiny caption.

- Use semantic colors through Tailwind utilities. Do not copy literal values
  from this document into product components or add independent dark patches.
- Raised cards, dialogs and popups use `bg-surface-modal`; recessed controls use
  `bg-surface-input`; navigation uses `bg-surface-sidebar`.
- Use `text-foreground` for titles and primary content, and
  `text-muted-foreground` for supporting content. Avoid combining small text,
  muted color and extra opacity.
- Neutral selection uses `bg-black/5 dark:bg-white/10`. Dropdown selection uses
  the shared `bg-primary/10` and trailing primary dot. Reuse
  `menuOptionStateClass` and `MenuSelectionIndicator`.
- Use the light/dark status pairs documented in `globals.css`. Pair color with
  a label or icon so status never depends on color alone.

## Typography

```yaml
typography:
  page-title:
    fontFamily: &ui-sans '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
    fontSize: 24px
    lineHeight: 32px
    fontWeight: 500
    letterSpacing: 0em
  dialog-title:
    fontFamily: *ui-sans
    fontSize: 20px
    lineHeight: 28px
    fontWeight: 500
  section-title:
    fontFamily: *ui-sans
    fontSize: 16px
    lineHeight: 24px
    fontWeight: 500
  popup-label:
    fontFamily: *ui-sans
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 500
  body:
    fontFamily: *ui-sans
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 400
  reading:
    fontFamily: *ui-sans
    fontSize: 16px
    lineHeight: 26px
    fontWeight: 400
  control:
    fontFamily: *ui-sans
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 500
  supporting:
    fontFamily: *ui-sans
    fontSize: 13px
    lineHeight: 18px
    fontWeight: 400
  caption:
    fontFamily: *ui-sans
    fontSize: 12px
    lineHeight: 16px
    fontWeight: 400
  caption-emphasis:
    fontFamily: *ui-sans
    fontSize: 12px
    lineHeight: 16px
    fontWeight: 500
```

Use the configured `font-sans` system stack, normal tracking, regular weight (400)
for reading and medium weight (500) for emphasis. Operation text and reading text
have separate roles: short controls need efficient scanning; conversation text
and task composition need a comfortable reading rhythm. Use size, line height and
weight together. Values are CSS pixels at the default root font size; application
zoom scales the whole UI.

| Role | Token | Existing Tailwind expression |
| --- | --- | --- |
| Page title / new-task greeting | {typography.page-title} | `text-2xl font-medium` |
| Dialog / drawer title | {typography.dialog-title} | `text-xl font-medium` |
| Section / card title | {typography.section-title} | `text-base font-medium` |
| Popup content title | {typography.popup-label} | `text-sm font-medium` |
| Short description / form input / contextual group label | {typography.body} | `text-sm font-normal` |
| Conversation prose / main task input / long reading | {typography.reading} | `text-base leading-relaxed font-normal` |
| Button / tab / field label / icon-led choice name | {typography.control} | `text-sm font-medium` |
| Supporting metadata, such as time and source | {typography.supporting} | `text-meta font-normal` |
| Compact caption | {typography.caption} | `text-xs font-normal` |
| Compact badge | {typography.caption-emphasis} | `text-xs font-medium` |

These roles apply across components. A popup heading and a section heading have
different roles even if both use a heading element. A form label, provider group
and model option must remain readable; none is a micro caption.

- Placeholder text inherits the input's size.
- Instructions needed to configure or complete a task use the body role, even
  when their color is secondary. Reserve supporting/caption styles for actual
  metadata and minor annotations. Reading text retains its own size and leading;
  do not shrink it to match the surrounding toolbar.
- Popup group labels, including provider names, must be **at least as large as
  their options**. Use color and group spacing to express the relationship.
  Distinguish a content title from a contextual instruction such as choosing the
  current task's model. The instruction and provider labels use regular body text
  in the secondary color; actionable model names use the medium control role.
  Preserve this emphasis relationship even when all three use the same font size.
- Selection uses the shared background and indicator; do not change font size
  or weight on selection in a way that shifts layout.
- Ordinary UI text must not use 10/11px. A genuinely tiny, nonessential numeric
  marker may use `text-2xs`; essential names, instructions, statuses, buttons
  and tooltips must use the roles above. Existing `text-tiny`, `text-subtitle`
  and `text-stat` tokens remain available for legacy callers, not new defaults.
- Use the named Tailwind sizes above rather than arbitrary `text-[Npx]`, inline
  font sizes or page-local size variables. Improve density through spacing and
  structure before reducing text size.
- Headings use `font-sans font-medium tracking-normal`; avoid serif display
  fonts, heavy weights and decorative letter spacing in application chrome.
  Use `font-mono` for code/logs and technical values when alignment helps.
  Provider names and model names remain ordinary UI text.

User-authored Markdown, code editors, document previews, charts and approved brand
artwork have their own content requirements. Their typography may differ from
application chrome. Keep such exceptions scoped to the content renderer; record
any new exception and its purpose in the change description. A recurring UI need
must become a project role here and a shared implementation, not a local scale.

## Layout

```yaml
spacing:
  unit: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  page-gutter: 32px
  popup-inset: 6px
  option-gap: 4px
  group-gap: 8px
```

- Use the existing management-page shell and 32px desktop gutters (`p-8`), with
  consistent responsive gutters when the available width requires them. Keep
  headings and toolbar actions aligned across pages.
- Use the four-pixel spacing grid for layout. Shared primitives may retain
  optical adjustments such as six-pixel popup padding; reuse them instead of
  adding a new density for every feature.
- Density is scoped by purpose. Compact menus prioritize efficient scanning;
  forms, cards and conversation text retain the room needed to read and operate
  them. Use the existing shared control variants instead of forcing every row,
  button and input into one height.
- Standard single-line dropdown options have a 28px minimum height, four-pixel
  vertical padding and four-pixel gaps. Use `clawx-menu-item` and
  `clawx-menu-list`. Description rows grow naturally. Larger text must not be
  clipped or forced into a fixed-height row.
- Separate groups more than options within a group. Align group labels with the
  popup heading and the leading edge of option content; leading icons and names
  stay grouped inside option rows. Small size differences cannot repair broken
  alignment or reversed emphasis.
- Keep related search and filter controls in one toolbar. Preserve space around
  interactive rows so hover and selection surfaces do not touch panel edges.
- Let the intended content region scroll, keep important actions reachable and
  avoid duplicated bottom padding. Long labels and narrow windows must not
  overflow horizontally or push essential controls out of view.
- Keep paragraph leading and meaningful space between content groups. Reduce
  redundant containers and repeated headings before taking space away from the
  reading area. A compact composer footer must not dictate the main input's type.

## Elevation & Depth

Use the canvas, recessed controls and lifted surfaces to communicate depth.
Ordinary content relies on alignment and light boundaries. Reserve shadows for
floating or deliberately lifted surfaces, using the existing shared wrappers.
Do not accumulate independent shadows, borders and containers around the same
content. Overlay layers must describe the current interaction, with focus and
dismissal owned by the shared Radix primitives.

## Shapes

```yaml
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  2xl: 16px
  3xl: 24px
```

These values map to the existing Tailwind radius scale. Compact controls and menu
rows use smaller radii; raised popups and dialogs use larger radii; the composer
uses the softest large radius. Keep the shared primitive's chosen radius rather
than inventing a different shape for each provider or page. Status dots remain
circular. Preserve the approved ClawX brand artwork.

Treat this as an available scale, not a requirement to use every step in each
view. Repeated roles share the same primitive and radius. Express hierarchy
through a small set of consistent control, raised-surface and composer shapes.

## Components

```yaml
components:
  button-primary:
    backgroundColor: "{colors.primary-action}"
    textColor: "{colors.on-primary}"
    typography: "{typography.control}"
  button-primary-dark:
    backgroundColor: "{colors.primary-action-dark}"
    textColor: "{colors.on-primary-dark}"
    typography: "{typography.control}"
  message-user:
    backgroundColor: "{colors.message-user}"
    textColor: "{colors.on-primary}"
    typography: "{typography.reading}"
  popup-title:
    textColor: "{colors.foreground}"
    typography: "{typography.popup-label}"
  popup-group:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
  popup-instruction:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
  menu-option:
    textColor: "{colors.foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
```

Component bindings reuse project roles; they do not introduce separate scales.
Color references above describe the light palette unless explicitly marked dark.
The runtime uses the existing theme-aware CSS variables for the equivalent role.

### Choosing a list layout

Choose the structure by how people use the items, not by page name or item
count. Use one pattern for items with the same role on a page; do not change
layouts when a collection grows from one item to several.

| Pattern | Use when | Construction and example |
| --- | --- | --- |
| Grouped rows | People scan or manage a collection of comparable settings or connections. Each item needs a short summary and compact actions. | One `rounded-xl` surface with a subtle border, no shadow, and `divide-y divide-border` between rows. Inset the rows and separators together by 16px from each outer edge; use 12px vertical row padding and let longer content grow. Separators do not touch the outer card border. The conversation model providers use this pattern. |
| Independent cards | Items represent distinct things a person recognizes, compares or starts working with, and each needs several pieces of information or its own action. | A responsive grid, 12–16px between cards; each card has a `rounded-xl` surface, subtle border, no shadow and 16px padding. Assistants and skills are candidates because they have distinct identities, descriptions and actions. Collapse to one column when there is insufficient space. |
| Unboxed rows | Content already belongs to a panel or drawer and the surrounding context supplies the boundary. | Use spacing and restrained separators as needed; do not wrap each row in another card. Workspace files and settings within an existing section are examples. |

One large card containing divided rows is a **collection boundary**, not an
independent card for every item. An independent card should earn its space: do
not use a grid merely because there are icons, or add a footer and divider when
an item only needs a name and one action. Conversely, do not compress detailed
items into rows if it makes descriptions or actions hard to scan. Do not nest a
collection card inside another decorative card; preserve clear hover, focus and
selection states regardless of layout. These examples are starting points, not
exemptions from reviewing a page's actual content.

### Surfaces, color and shape

Use the canvas as the default. A boundary is for a real group, individual item,
input or floating layer, not for every piece of content. Avoid multiple borders,
shadows and nested backgrounds expressing the same boundary. For normal cards
and grouped collections use `bg-surface-modal`, `border-border`, `rounded-xl`
(12px) and no shadow; a subtle hover boundary is appropriate only if an item
is actionable. Use the shared button radius `rounded-md` (6px) for buttons, `rounded-lg`
(8px) for menu rows and compact input surfaces, `rounded-xl` for ordinary cards,
and the shared dialog/popover treatment for floating surfaces. The composer retains its larger shape. Do not independently
round individual rows inside an already rounded collection unless necessary
for an interaction state.

Primary blue is for the main action or meaningful selection; neutral surfaces
and text carry most structure. Use other colors for an actual state or a
recognizable content icon, not as decoration on every container. Stable
identities may have accents, but do not assign semantic meaning to arbitrary
colors or let status depend on color alone. Both themes use semantic tokens, with
text and interactive states checked against their rendered surfaces. The filled primary action uses
`bg-primary-action` and `hover:bg-primary-action-hover` in both themes so its
light label meets contrast requirements;
`primary` remains the brighter dark-mode accent for text and selections. User
message bubbles use `bg-message-user` with `text-primary-foreground` for readable
conversation text; do not apply the decorative brand blue to long-form text.

For interaction states, apply these roles consistently across light and dark
modes rather than adding a new color for each page:

| State | Treatment |
| --- | --- |
| Resting | Foreground content on the canvas or its purposeful surface; borders use `border-border`. |
| Hover | An interactive row or control may use the shared neutral hover background; static text and badges have no hover state. |
| Selected | Navigation and tabs use the neutral selected surface; dropdown options use the shared primary tint and dot. Selection remains distinguishable after hover ends. |
| Focus | Shared visible keyboard focus; text fields use the quieter neutral focus treatment documented in `globals.css`. |
| Disabled | Use the shared control's disabled state and semantics. Keep the label legible and do not imply that it can be activated. |
| Success / warning / error | Use the status treatments in `globals.css` and a readable label or icon; avoid status colors for ordinary category decoration. |

### Buttons and actions

- Use the shared `Button` variants. A page or dialog normally has one primary
  filled action; use outline for a secondary action, ghost for low-emphasis
  contextual actions, and destructive styling for a consequential destructive
  confirmation. Do not make every item in a list a filled primary button.
- Use the shared compact 36px (`size="sm"`) control for management toolbars and
  dialog actions; use a 32px icon or contextual action where appropriate. The
  shared default 40px and larger controls remain available for places that
  require them. Text follows the control role; do not shrink it to caption size
  to make a button look compact. Align actions and keep the same roles in empty,
  loading and populated states.
- Keep frequently used actions directly visible when space allows. Move actions
  into an overflow menu only for actual crowding or rare operations. Icon-only
  actions have an accessible name and a tooltip; a destructive operation must
  remain identifiable without relying on red alone.

### Badges, status and metadata

- A badge is a short, non-interactive label that helps identify a meaningful
  category or status (for example skill source or default assistant). Use the
  shared `Badge` with `variant="secondary"` and compact caption typography for
  neutral metadata. Keep a badge on the same line as the associated content
  when there is room; avoid repeating the same label for every item when a
  group heading can express it once.
- Use success, warning or destructive color only for corresponding states and
  pair it with text or an icon. Plain descriptions, dates, paths and model IDs
  are usually supporting text, not badges. Do not make passive badges look
  clickable with hover effects or focus rings. Filters and actions are buttons,
  tabs or other semantic controls rather than clickable badges.
- The shared badge uses `rounded-full`, 12px medium text and 10px horizontal /
  2px vertical padding. A compact in-row badge may use 8px horizontal padding;
  keep this exception consistent within the same list. Do not add a shadow.
- Prefer a small number of badges per item, concise text and predictable
  padding. Preserve the full meaning for assistive technology and long locales;
  truncate visually only where an alternative way to read the text remains.

### Interaction and reuse

- Use shared Radix Dialog, DropdownMenu, Select, Popover, Tooltip and Tabs wrappers.
  The detailed floating-layer lifecycle rules in AGENTS.md still apply.
- Reuse existing feature capabilities before adding another implementation.
  Assistant and task model choices share ModelPicker; file readers share the
  Workspace preview capability; configuration forms reuse ConfigDialogContent.
- Configuration dialogs use the shared bounded header/body/footer layout, with
  the standard `max-w-xl` width. Content-heavy readers may need more room;
  choose a purposeful shared variant rather than per-provider layouts.
- Avoid stacking modal dialogs. File reading from a detail dialog uses the
  existing right drawer and shared reader, with focus returning to its opener.
- Icon-only controls need a localized accessible name and a hover/focus tooltip.
  Preserve keyboard operation, Escape/outside dismissal and focus return.
- Text inputs use a quiet neutral focus border/ring. Keyboard focus must remain
  visible on all interactive controls. Reuse the shared field treatment.
- Reuse shared motion, including reduced-motion support. Do not add page-specific
  timers or independent animation values to recreate a shared interaction.

## Do's and Don'ts

1. Identify each text role and reuse the matching project style. Check shared
   defaults before overriding them. Fix a shared default once when its scope is
   shared; do not repair it separately at every call site.
2. Bring the touched UI into alignment incrementally. Do not perform a blind
   global token replacement: the same old size may serve different roles.
   Check the resulting visual emphasis and alignment; matching numeric roles
   alone does not establish a successful design.
3. Review a real Electron screenshot and computed styles, including a narrow
   window, light/dark themes and longer localized text where relevant. Check
   density, truncation, focus and usable scrolling.
4. Update Electron E2E coverage for visible UI changes as required by AGENTS.md.
   Check representative computed sizes and interactions rather than relying on
   class-name snapshots. Documentation-only changes need no new UI test.
5. Keep the [UI Harness rule](harness/specs/rules/ui-i18n-design-tokens.md) linked
   to this contract. Harness validates specs and selects checks; design review
   and UI tests are still needed to establish visual compliance.

### Rationale and references

These references inform the contract; ClawX keeps its own product identity and
tests the resulting choices in its Electron UI.

- [Fluent typography](https://fluent2.microsoft.design/typography) supports a
  compact application scale, including 14/20 body text and 24/32 headings.
- [Geist typography](https://vercel.com/geist/typography) separates labels/buttons
  from reading copy, combining size, leading and weight into reusable roles.
- [Atlassian typography](https://atlassian.design/foundations/typography/applying-typography)
  distinguishes short UI content from longer reading and reserves tiny type
  for fine print.
- The getdesign.md analyses of [Claude](https://getdesign.md/claude/design-md),
  [Notion](https://getdesign.md/notion/design-md) and
  [Raycast](https://getdesign.md/raycast/design-md) inform warmth, quiet chrome,
  purposeful color and compact interaction. They are independent analyses, often
  of marketing sites; their display sizes, fonts and section spacing are not
  application defaults for ClawX.

Validate document structure and token references with the official CLI:

```sh
pnpm --package=@google/design.md@0.4.0 dlx designmd lint DESIGN.md
```

This checks the design document, not whether every runtime component complies.
Do not blindly export it over the existing Tailwind theme: ClawX retains its
shared wrappers, theme switching, content-specific tokens and incremental rollout.

### Current convergence notes

The original dark primary accent and light foreground had insufficient contrast
for filled actions. Filled actions use the separately bound primary-action token;
the brighter dark accent remains available for text and selection. Palette tokens
without explicit component bindings produce orphan-token warnings; their runtime
mappings remain in `globals.css`.
