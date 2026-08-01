# Streamdown Plugins Reference

## Table of Contents

- [Plugin Overview](#plugin-overview)
- [@streamdown/code](#streamdowncode)
- [@streamdown/mermaid](#streamdownmermaid)
- [@streamdown/math](#streamdownmath)
- [@streamdown/cjk](#streamdowncjk)
- [Built-in Remark Plugins](#built-in-remark-plugins)
- [Built-in Rehype Plugins](#built-in-rehype-plugins)
- [Customizing Built-in Plugins](#customizing-built-in-plugins)

## Plugin Overview

Each plugin is a standalone package. Install only what's needed:

```bash
npm install @streamdown/code @streamdown/mermaid @streamdown/math @streamdown/cjk
```

```tsx
import { code } from '@streamdown/code';
import { mermaid } from '@streamdown/mermaid';
import { math } from '@streamdown/math';
import { cjk } from '@streamdown/cjk';
import 'katex/dist/katex.min.css'; // Required for math

<Streamdown plugins={{ code, mermaid, math, cjk }}>
  {markdown}
</Streamdown>
```

## @streamdown/code

Syntax highlighting via Shiki. Supports 200+ languages (lazy-loaded on demand).

**Install:**
```bash
npm install @streamdown/code
```

**Default usage:**
```tsx
import { code } from '@streamdown/code';

<Streamdown plugins={{ code }}>{markdown}</Streamdown>
```

**Custom themes:**
```tsx
import { createCodePlugin } from '@streamdown/code';

const code = createCodePlugin({
  themes: ['github-light', 'github-dark'], // [light, dark]
});
```

Theme is also configurable via the `shikiTheme` prop on Streamdown:
```tsx
<Streamdown plugins={{ code }} shikiTheme={['one-light', 'one-dark-pro']}>
  {markdown}
</Streamdown>
```

**Features:**
- Copy button on hover (disabled during streaming)
- Download button with correct file extension
- 200+ languages: js, ts, python, go, java, rust, c, cpp, ruby, php, swift, kotlin, etc.
- Token caching for performance
- Lazy language loading

**Streaming behavior:** Unterminated code blocks are gracefully handled by remend. Copy/download buttons disabled when `isAnimating={true}`.

**Common issue — Shiki external package warning:**
If using Next.js and seeing warnings, install shiki explicitly and add to `next.config.js`:
```js
transpilePackages: ['shiki'],
```

## @streamdown/mermaid

Interactive Mermaid diagrams.

**Install:**
```bash
npm install @streamdown/mermaid
```

**Default usage:**
```tsx
import { mermaid } from '@streamdown/mermaid';

<Streamdown plugins={{ mermaid }}>{markdown}</Streamdown>
```

**Custom config:**
```tsx
import { createMermaidPlugin } from '@streamdown/mermaid';

const mermaid = createMermaidPlugin({
  config: {
    theme: 'dark', // 'default' | 'dark' | 'forest' | 'neutral' | 'base'
    fontFamily: 'monospace',
  },
});
```

**Mermaid options on Streamdown:**
```tsx
<Streamdown
  plugins={{ mermaid }}
  mermaid={{
    config: { theme: 'neutral' },
    errorComponent: ({ error, chart, retry }) => (
      <div>
        <p>Failed to render: {error}</p>
        <button onClick={retry}>Retry</button>
      </div>
    ),
  }}
>
  {markdown}
</Streamdown>
```

**Supported diagram types:** Flowcharts, sequence, state, class, pie, Gantt, ER, git graphs.

**Interactive controls:** Fullscreen, download SVG, copy source, pan/zoom. Customize via `controls` prop:
```tsx
<Streamdown
  plugins={{ mermaid }}
  controls={{
    mermaid: { download: true, copy: true, fullscreen: true, panZoom: false },
  }}
>
```

**Streaming behavior:** Diagrams render as code blocks until the mermaid block is complete.

## @streamdown/math

LaTeX math via KaTeX.

**Install:**
```bash
npm install @streamdown/math
```

**Usage (CSS import required):**
```tsx
import { math } from '@streamdown/math';
import 'katex/dist/katex.min.css';

<Streamdown plugins={{ math }}>{markdown}</Streamdown>
```

**Custom config:**
```tsx
import { createMathPlugin } from '@streamdown/math';

const math = createMathPlugin({
  singleDollarTextMath: true, // Enable $...$ syntax (default: false)
  errorColor: '#ff0000',
});
```

**Syntax:**
- Inline: `$$E = mc^2$$` (same line)
- Block: `$$\nE = mc^2\n$$` (separate lines)
- Default uses double `$$` only (not single `$`) to avoid conflicts with currency

**Streaming behavior:** Incomplete `$$` blocks are auto-closed by remend.

## @streamdown/cjk

Chinese, Japanese, Korean text support.

**Install:**
```bash
npm install @streamdown/cjk
```

**Usage:**
```tsx
import { cjk } from '@streamdown/cjk';

<Streamdown plugins={{ cjk }}>{markdown}</Streamdown>
```

**What it fixes:**
- Emphasis markers adjacent to ideographic punctuation (bold, italic, strikethrough)
- Autolinks swallowing trailing CJK punctuation

**Supported punctuation:** `。．，、？！：；（）【】「」『』〈〉《》`

## Built-in Remark Plugins

**remark-gfm** — GitHub Flavored Markdown:
- Tables (with alignment)
- Task lists (`- [ ]`, `- [x]`)
- Strikethrough (`~~text~~`)
- Autolinks
- Footnotes (`[^1]`)

## Built-in Rehype Plugins

1. **rehype-raw** — Preserves raw HTML in Markdown
2. **rehype-sanitize** — XSS protection
3. **rehype-harden** — URL/protocol restrictions:
   ```tsx
   {
     allowedImagePrefixes: ['*'],
     allowedLinkPrefixes: ['*'],
     allowedProtocols: ['*'],
     defaultOrigin: undefined,
     allowDataImages: true,
   }
   ```

## Customizing Built-in Plugins

```tsx
import { defaultRemarkPlugins, defaultRehypePlugins } from 'streamdown';

// Add custom plugins alongside defaults
<Streamdown
  remarkPlugins={[...Object.values(defaultRemarkPlugins), myCustomPlugin]}
  rehypePlugins={[...Object.values(defaultRehypePlugins), anotherPlugin]}
>
  {markdown}
</Streamdown>
```

**Disable HTML entirely** by omitting rehype-raw:
```tsx
const { raw, ...rest } = defaultRehypePlugins;
<Streamdown rehypePlugins={Object.values(rest)}>{markdown}</Streamdown>
```
