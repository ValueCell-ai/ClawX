/** @type {import('tailwindcss').Config} */

/* ──────────────────────────────────────────────────────────────────────────
 * ClawX Tailwind design tokens
 * ──────────────────────────────────────────────────────────────────────────
 *
 * This config layers ClawX's own visual language on top of shadcn/ui:
 *
 *   1. fontFamily — Both stacks (sans / mono) are pinned
 *      explicitly so we never silently inherit Tailwind's evolving defaults.
 *      Each platform resolves the stack through its installed system fonts.
 *
 *   2. fontSize — Implements extra tokens alongside Tailwind's default
 *      scale. DESIGN.md owns text roles and their permitted usage; token
 *      availability does not make every size appropriate for ordinary UI.
 *
 *   3. colors — On top of shadcn's semantic tokens (primary / destructive /
 *      ...) we add three ClawX-private groups:
 *        - brand        : Apple-system blue for rare branded surfaces, not default CTAs
 *        - skill        : highlight blue for inline /skill chips in chat
 *        - surface.{modal,input,sidebar}: a 3-layer neutral background
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
 *     - Design roles : DESIGN.md (canonical project-wide contract)
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
    './node_modules/streamdown/dist/*.js',
    './node_modules/@streamdown/code/dist/*.js',
    './node_modules/@streamdown/math/dist/*.js',
    './node_modules/@streamdown/cjk/dist/*.js',
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
       * Both stacks are pinned explicitly to remove dependency on
       * Tailwind's default fontFamily values. The intent:
       *
       *   - sans  : the everyday UI body / control font. Apple-first
       *             on macOS (-apple-system), then BlinkMacSystemFont
       *             so Chromium on macOS picks the same metrics, then
       *             Segoe UI for Windows, Roboto for Linux/Android,
       *             and finally the four Apple/Segoe/Noto color emoji
       *             fonts so emoji never fall back to a serif.
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
       * Use DESIGN.md's Typography table to select the role before the
       * token. Keep the underlying Tailwind scale and legacy additions
       * available for incremental convergence and content renderers.
       * Do not add a second role/size table here.
       *
       * Keep custom names in sync with src/lib/utils.ts so cn() can
       * distinguish font-size utilities from text-color utilities.
       * ────────────────────────────────────────────────────────────── */
      fontSize: {
        '2xs':      ['10px', { lineHeight: '14px' }],
        tiny:       ['11px', { lineHeight: '16px' }],
        meta:       ['13px', { lineHeight: '18px' }],
        subtitle:   ['17px', { lineHeight: '24px' }],
        // Legacy display token; new application text follows DESIGN.md.
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
       *   - bg-primary-action       → primary CTA background
       *   - bg-brand                → rare branded surfaces
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
        'message-user': 'hsl(var(--message-user) / <alpha-value>)',
        'primary-action': {
          DEFAULT: 'hsl(var(--primary-action) / <alpha-value>)',
          hover: 'hsl(var(--primary-action-hover) / <alpha-value>)',
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
        // Apple-system blue for occasional branded surfaces, not primary CTAs.
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

        // ── C. ClawX neutral surfaces ────────────────────────────────
        // We use `<alpha-value>` placeholders so Tailwind auto-emits
        // `bg-surface-xxx/{alpha}` rules. Concrete pixel values live in
        // globals.css; in dark mode the same CSS variables redirect to
        // shadcn's existing dark tokens to avoid maintaining a second
        // dark surface palette.
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
