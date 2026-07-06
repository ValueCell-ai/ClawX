# Light Neutral Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ClawX's warm cream-based light theme with a white and neutral-gray palette while preserving the existing dark theme.

**Architecture:** Keep the change centralized in the design-token layer. Components already consume `bg-background`, `bg-surface-modal`, `bg-surface-input`, and `bg-surface-sidebar`, so implementation should update CSS variables and documentation comments rather than restyling components.

**Tech Stack:** Electron, React 19, Vite, TypeScript, Tailwind CSS, Playwright Electron E2E tests.

---

## File Structure

- Modify `src/styles/globals.css`: Owns light and dark CSS color variables plus component convention comments. This file is the only runtime style file that should change.
- Modify `tailwind.config.js`: Owns Tailwind color token documentation and mapping comments. No Tailwind runtime mapping changes are required.
- Create `tests/e2e/light-neutral-theme.spec.ts`: Verifies computed light theme colors are neutral white/gray and verifies dark token values remain unchanged.
- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`: No expected changes because current docs describe adaptive theming generically.

Repository rule: do not create git commits unless the user explicitly grants commit permission. The optional commit steps below are only executable after that permission exists.

### Task 1: Add Failing E2E Coverage For Theme Tokens

**Files:**
- Create: `tests/e2e/light-neutral-theme.spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Create `tests/e2e/light-neutral-theme.spec.ts` with this exact content:

```ts
import { closeElectronApp, expect, test } from './fixtures/electron';

type ThemeSnapshot = {
  raw: Record<string, string>;
  computed: Record<string, string>;
};

async function readThemeSnapshot(page: import('@playwright/test').Page, mode: 'light' | 'dark'): Promise<ThemeSnapshot> {
  return await page.evaluate((themeMode) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(themeMode);

    const variables = ['--background', '--surface-modal', '--surface-input', '--surface-sidebar'];
    const rootStyle = window.getComputedStyle(root);

    const raw: Record<string, string> = {};
    const computed: Record<string, string> = {};

    for (const variable of variables) {
      raw[variable] = rootStyle.getPropertyValue(variable).trim();

      const probe = document.createElement('div');
      probe.style.color = `hsl(var(${variable}))`;
      document.body.appendChild(probe);
      computed[variable] = window.getComputedStyle(probe).color;
      probe.remove();
    }

    return { raw, computed };
  }, mode);
}

test.describe('ClawX light neutral theme tokens', () => {
  test('uses white and neutral gray surfaces in light mode without changing dark mode tokens', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const light = await readThemeSnapshot(page, 'light');
      expect(light.raw).toEqual({
        '--background': '0 0% 100%',
        '--surface-modal': '0 0% 100%',
        '--surface-input': '0 0% 96.5%',
        '--surface-sidebar': '0 0% 96%',
      });
      expect(light.computed).toEqual({
        '--background': 'rgb(255, 255, 255)',
        '--surface-modal': 'rgb(255, 255, 255)',
        '--surface-input': 'rgb(246, 246, 246)',
        '--surface-sidebar': 'rgb(245, 245, 245)',
      });

      const dark = await readThemeSnapshot(page, 'dark');
      expect(dark.raw).toEqual({
        '--background': '240 4% 11%',
        '--surface-modal': '240 3% 14%',
        '--surface-input': '240 3% 18%',
        '--surface-sidebar': '240 4% 11%',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for the current cream palette**

Run:

```bash
pnpm run build:vite && pnpm exec playwright test tests/e2e/light-neutral-theme.spec.ts --reporter=list
```

Expected result: FAIL. The failure should show `light.raw` still contains the existing warm values such as `45 30% 96.6%`, `45 30% 97.6%`, `45 22% 94%`, or `45 16% 94%` instead of the expected neutral values.

### Task 2: Replace Light Theme Cream Tokens With Neutral Tokens

**Files:**
- Modify: `src/styles/globals.css`
- Test: `tests/e2e/light-neutral-theme.spec.ts`

- [ ] **Step 1: Update the top-level token overview comments**

In `src/styles/globals.css`, replace the comments that describe ClawX surfaces as cream layers with neutral layer language. The affected comment block should read:

```css
 *   2. ClawX surface tokens (--surface-modal / --surface-input /
 *      --surface-sidebar). Three light-mode neutral layers added
 *      by ClawX. In dark mode each one is redirected to an existing
 *      shadcn token (--card / --muted / --background) so we don't have
 *      to maintain a second dark surface palette.
```

- [ ] **Step 2: Update component convention wording**

In the `PANEL SURFACES` convention block in `src/styles/globals.css`, make this wording exact:

```css
 *     bg-surface-modal = raised neutral panels, popovers, inputs, cards
 *     bg-surface-input = recessed neutral code/log <pre>, segmented track
```

In the `STATUS COLOURS` block, replace the cream-specific warning with this wording:

```css
 *     Avoid `text-X-400` alone — that shade is tuned for dark mode and
 *     washes out against the light theme. Same for `bg-red-900/20`
 *     panel backgrounds (a dark-only relic).
```

- [ ] **Step 3: Update light shadcn background token comment and value**

Replace the existing light `--background` comment and value with:

```css
    /* Clean neutral page background matching the white/gray light theme. */
    --background: 0 0% 100%;
```

Leave `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, and `--radius` unchanged.

- [ ] **Step 4: Update light ClawX surface token comments and values**

Replace the entire light surface comment block and values with:

```css
    /* ── ClawX neutral surfaces (light) ───────────────────────────
     *
     * Three stacked neutral layers. The app shell stays white while
     * recessed controls and the sidebar use subtle gray contrast.
     *
     *   --surface-modal   = lifted neutral panels, dialogs, popovers,
     *                       composer, cards
     *   --surface-input   = recessed neutral inputs / selects / code panes
     *   --surface-sidebar = sidebar neutral navigation rail (often /60)
     * ─────────────────────────────────────────────────────────── */
    --surface-modal: 0 0% 100%;
    --surface-input: 0 0% 96.5%;
    --surface-sidebar: 0 0% 96%;
```

- [ ] **Step 5: Update the dark-mode surface comment without changing dark values**

Change only the comment before dark surface tokens to remove cream wording. It should read:

```css
    /* In dark mode the three neutral surfaces collapse onto existing
     * shadcn tokens:
     *     modal   → card
     *     input   → muted
     *     sidebar → background
     * This way every `bg-surface-*` utility resolves correctly in
     * both themes, and components no longer need `dark:bg-card`-style
     * companion classes for theme switching. */
```

Do not change these values:

```css
    --surface-modal: 240 3% 14%;
    --surface-input: 240 3% 18%;
    --surface-sidebar: 240 4% 11%;
```

- [ ] **Step 6: Update Monaco diff comment**

Replace the Monaco light-theme comment with:

```css
/* Monaco's default light diff theme is pure white; keep it aligned with ClawX's light app background. */
```

- [ ] **Step 7: Run the focused E2E test and verify it passes**

Run:

```bash
pnpm run build:vite && pnpm exec playwright test tests/e2e/light-neutral-theme.spec.ts --reporter=list
```

Expected result: PASS for `ClawX light neutral theme tokens`.

### Task 3: Update Tailwind Token Documentation Comments

**Files:**
- Modify: `tailwind.config.js`

- [ ] **Step 1: Update the top color group description**

In `tailwind.config.js`, replace the surface description in the file header with:

```js
 *        - surface.{modal,input,sidebar}: a 3-layer neutral background
 *                          system in light mode. In dark mode each layer
 *                          collapses to an existing shadcn token through
 *                          CSS variables, so callers don't need to write
 *                          `dark:bg-card` style double-declarations.
```

- [ ] **Step 2: Update the surface token group comment**

Replace the `// ── C. ClawX cream surfaces` comment block with:

```js
        // ── C. ClawX neutral surfaces ────────────────────────────────
        // We use `<alpha-value>` placeholders so Tailwind auto-emits
        // `bg-surface-xxx/{alpha}` rules. Concrete pixel values live in
        // globals.css; in dark mode the same CSS variables redirect to
        // shadcn's existing dark tokens to avoid maintaining a second
        // dark surface palette.
```

- [ ] **Step 3: Verify no stale cream guidance remains in token files**

Run:

```bash
rg "cream|warm paper|warm-paper|dark-cream|cream palette" src/styles/globals.css tailwind.config.js
```

Expected result: no output and exit code `1`, meaning no stale cream-theme wording remains in these token documentation files.

### Task 4: Documentation Review And Final Validation

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`

- [ ] **Step 1: Confirm README files do not describe the old warm palette**

Run:

```bash
rg "cream|warm|米黄|暖色|クリーム|暖色" README.md README.zh-CN.md README.ja-JP.md
```

Expected result: no matches that describe the app's light theme as cream or warm. If there are no matches, do not edit the README files.

- [ ] **Step 2: Run TypeScript validation**

Run:

```bash
pnpm run typecheck
```

Expected result: PASS for both `typecheck:node` and `typecheck:web`.

- [ ] **Step 3: Run focused E2E validation**

Run:

```bash
pnpm run build:vite && pnpm exec playwright test tests/e2e/light-neutral-theme.spec.ts --reporter=list
```

Expected result: PASS.

- [ ] **Step 4: Inspect the final worktree**

Run:

```bash
git status --short
git diff -- src/styles/globals.css tailwind.config.js tests/e2e/light-neutral-theme.spec.ts docs/superpowers/specs/2026-07-06-light-neutral-theme-design.md docs/superpowers/plans/2026-07-06-light-neutral-theme.md
```

Expected result: only the intended theme token, token comment, E2E test, spec, and plan files appear in this task's diff. Do not revert or modify unrelated changes such as user edits in `src/pages/Chat/index.tsx`.

- [ ] **Step 5: Optional commit only if explicitly permitted**

If the user has explicitly asked for a commit, run:

```bash
git add src/styles/globals.css tailwind.config.js tests/e2e/light-neutral-theme.spec.ts docs/superpowers/specs/2026-07-06-light-neutral-theme-design.md docs/superpowers/plans/2026-07-06-light-neutral-theme.md
git commit -m "style: neutralize light theme palette"
```

Expected result: a commit containing only the intended files. If commit permission was not explicitly granted, skip this step.

## Self-Review Notes

- Spec coverage: The plan updates the centralized light tokens, leaves dark token values unchanged, updates cream/warm documentation comments, adds E2E coverage, and reviews README localization docs.
- Placeholder scan: No placeholder steps remain; every code change step includes exact content or exact commands.
- Type consistency: The E2E helper uses the existing `tests/e2e/fixtures/electron` exports and checks the same token names defined in `src/styles/globals.css` and mapped by `tailwind.config.js`.
