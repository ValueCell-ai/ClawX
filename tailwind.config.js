/** @type {import('tailwindcss').Config} */

/* ──────────────────────────────────────────────────────────────────────────
 * ClawX Tailwind design tokens
 * ──────────────────────────────────────────────────────────────────────────
 *
 * This config layers ClawX's own visual language on top of shadcn/ui:
 *
 *   1. fontFamily — All three stacks (sans / serif / mono) are pinned
 *      explicitly so we never silently inherit Tailwind's evolving defaults.
 *      This locks the rendering on macOS, Windows, and Linux to the same
 *      glyph sources we ship to designers.
 *
 *   2. fontSize — We only *add* missing rungs to Tailwind's default scale.
 *      All new tokens come from the orphan pixel values (10/11/13/17/40px)
 *      that occurred most often in the codebase. Naming is semantic
 *      (`meta`, `tiny`, `subtitle`, `2xs`, `stat`) so a future density
 *      change only touches this file.
 *
 *   3. colors — On top of shadcn's semantic tokens (primary / destructive /
 *      ...) we add three ClawX-private groups:
 *        - brand        : Apple-system blue used for primary CTAs
 *        - skill        : highlight blue for inline /skill chips in chat
 *        - surface.{modal,input,sidebar}: a 3-layer cream-paper background
 *                          system in light mode. In dark mode each layer
 *                          collapses to an existing shadcn token through
 *                          CSS variables, so callers don't need to write
 *                          `dark:bg-card` style double-declarations.
 *
 *   4. Naming — All ClawX-private tokens live under their own top-level
 *      key (`brand`, `skill`, `surface`) instead of being merged into
 *      the root `colors` namespace, so they're trivially distinguishable
 *      from shadcn semantic tokens.
 *
 * Usage references:
 *     - Sizes        : see fontSize block below
 *     - Colors       : see colors block below
 *     - CSS variables: src/styles/globals.css
 *
 * ────────────────────────────────────────────────────────────────────────── */

module.exports = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      /* ──────────────────────────────────────────────────────────────
       * fontFamily
       * ──────────────────────────────────────────────────────────────
       *
       * All three stacks are pinned explicitly to remove dependency on
       * Tailwind's default fontFamily values. The intent:
       *
       *   - sans  : the everyday UI body / control font. Apple-first
       *             on macOS (-apple-system), then BlinkMacSystemFont
       *             so Chromium on macOS picks the same metrics, then
       *             Segoe UI for Windows, Roboto for Linux/Android,
       *             and finally the four Apple/Segoe/Noto color emoji
       *             fonts so emoji never fall back to a serif.
       *
       *   - serif : Georgia-first display stack used by all page H1/H2.
       *             Previously written as inline `style={{ fontFamily }}`
       *             in 17 places — that's been collapsed to this token,
       *             so `font-serif` alone now reproduces the original
       *             rendering exactly. (NOTE: deliberately omits
       *             `ui-serif` — on macOS that resolves to "New York"
       *             which we explicitly do not want.)
       *
       *   - mono  : standard developer-font stack. Used for IDs, paths,
       *             tokens, timestamps, code blocks, CLI output etc.
       *             We pin this so behaviour is identical to Tailwind's
       *             current default but immune to upstream changes.
       * ────────────────────────────────────────────────────────────── */
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          '"Noto Sans"',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
        serif: [
          'Georgia',
          'Cambria',
          '"Times New Roman"',
          'Times',
          'serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },

      /* ──────────────────────────────────────────────────────────────
       * fontSize
       * ──────────────────────────────────────────────────────────────
       *
       * Naming is by visual *role*, not pixel count, so a future density
       * change only edits the values here. ClawX's full size ladder
       * (combining Tailwind defaults + ClawX additions, smallest first):
       *
       *   ┌──────────────┬──────────┬─────────────┬──────────────────────────────┐
       *   │ Token        │ FontSize │ LineHeight  │ Primary use                  │
       *   ├──────────────┼──────────┼─────────────┼──────────────────────────────┤
       *   │ 2xs   (new)  │ 10px     │ 14px        │ micro labels, chip suffixes  │
       *   │ tiny  (new)  │ 11px     │ 16px        │ ultra-small captions, tips   │
       *   │ xs    (TW)   │ 12px     │ 16px        │ secondary helpers, badges    │
       *   │ meta  (new)  │ 13px     │ 18px        │ form/button/modal description│
       *   │ sm    (TW)   │ 14px     │ 20px        │ body (Label / CardDescription│
       *   │ base  (TW)   │ 16px     │ 24px        │ rare; Textarea fallback only │
       *   │ subtitle(new)│ 17px     │ 24px        │ subtitle right under page H1 │
       *   │ lg    (TW)   │ 18px     │ 28px        │ Sheet / Confirm titles       │
       *   │ xl    (TW)   │ 20px     │ 28px        │ Setup steps, large emoji     │
       *   │ 2xl   (TW)   │ 24px     │ 32px        │ CardTitle                    │
       *   │ 3xl   (TW)   │ 30px     │ 36px        │ section H2 (serif)           │
       *   │ 4xl   (TW)   │ 36px     │ 40px        │ Chat empty-state H1          │
       *   │ stat  (new)  │ 40px     │ 1           │ dashboard hero numbers       │
       *   │ 5xl   (TW)   │ 48px     │ 1           │ page H1 (narrow viewport)    │
       *   │ 6xl   (TW)   │ 60px     │ 1           │ page H1 (md and up)          │
       *   └──────────────┴──────────┴─────────────┴──────────────────────────────┘
       *
       * Tailwind defaults marked (TW) are intentionally untouched so
       * shadcn components keep their original rendering.
       * ────────────────────────────────────────────────────────────── */
      fontSize: {
        '2xs':      ['10px', { lineHeight: '14px' }],
        tiny:       ['11px', { lineHeight: '16px' }],
        meta:       ['13px', { lineHeight: '18px' }],
        subtitle:   ['17px', { lineHeight: '24px' }],
        // Display-size token used only by the Cron dashboard hero counters.
        // line-height: 1 (unitless) keeps the number tightly aligned with
        // the icon next to it, which is why we don't reuse 4xl/5xl here.
        stat:       ['40px', { lineHeight: '1' }],
      },

      /* ──────────────────────────────────────────────────────────────
       * colors
       * ──────────────────────────────────────────────────────────────
       *
       * Three groups:
       *   A. shadcn standard semantic tokens — read via `hsl(var(--xxx))`
       *      from globals.css. Kept fully compatible.
       *   B. ClawX brand tokens (brand / skill) — plain hex values that
       *      do not change between light and dark themes.
       *   C. ClawX surface tokens (surface.{modal,input,sidebar}) — use
       *      `hsl(var(--surface-xxx) / <alpha-value>)` so the alpha
       *      modifier still works (e.g. `bg-surface-sidebar/60`). The
       *      actual values live in globals.css, where dark mode redirects
       *      each surface to an existing shadcn token (--card / --muted /
       *      --background) — that way callers don't double-declare a
       *      `dark:bg-card` etc. on every surface element.
       *
       * Examples:
       *   - bg-brand                → primary CTA
       *   - hover:bg-brand-hover    → CTA hover
       *   - bg-skill-bg/14          → skill-chip backdrop in chat input
       *   - text-skill-fg           → skill-chip text in light mode
       *   - dark:text-skill-fg-dark → skill-chip text in dark mode
       *   - bg-surface-modal        → large rounded modal panels
       *   - bg-surface-input        → input fields / code panes
       *   - bg-surface-sidebar/60   → translucent left rail
       * ────────────────────────────────────────────────────────────── */
      colors: {
        // ── A. shadcn semantic tokens (do NOT rename — Radix/shadcn
        //       components read these names directly) ──
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── B. ClawX brand tokens ────────────────────────────────────
        // Apple-system blue used for primary CTAs. The same pixel value
        // works in both themes (sufficient WCAG-AA contrast in light
        // mode and stays vivid in dark mode), so no CSS variable needed.
        // Pair with `brand-hover` for the hover state.
        brand: {
          DEFAULT: '#0a84ff',
          hover: '#007aff',
        },

        // Highlight blue for inline /skill chips in the chat input.
        // The chip combines bg + text + text-shadow to produce a glow
        // effect, so we expose three separate tokens (bg, light fg,
        // dark fg) instead of a 50/100/.../900 ramp — this palette is
        // intentionally not extensible.
        skill: {
          bg: '#2F6BFF',          // chip backdrop (used at /14 or /18)
          fg: '#1D4ED8',          // chip text (light mode)
          'fg-dark': '#2563EB',   // chip text (dark mode)
        },

        // ── C. ClawX cream surfaces ──────────────────────────────────
        // We use `<alpha-value>` placeholders so Tailwind auto-emits
        // `bg-surface-xxx/{alpha}` rules. Concrete pixel values live in
        // globals.css; in dark mode the same CSS variables redirect to
        // shadcn's existing dark tokens to avoid maintaining a second
        // (dark) cream palette.
        surface: {
          modal: 'hsl(var(--surface-modal) / <alpha-value>)',
          input: 'hsl(var(--surface-input) / <alpha-value>)',
          sidebar: 'hsl(var(--surface-sidebar) / <alpha-value>)',
        },

        // ── D. ClawX usage accents ──────────────────────────────────
        // Semantic chart palette shared by the Models token-usage
        // visualisation and any future input/output/cache indicator.
        // Mirrors Cron's stat-tile palette (blue / green / yellow).
        // Values live in globals.css; dark mode brightens each one.
        usage: {
          input: 'hsl(var(--usage-input) / <alpha-value>)',
          output: 'hsl(var(--usage-output) / <alpha-value>)',
          cache: 'hsl(var(--usage-cache) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
