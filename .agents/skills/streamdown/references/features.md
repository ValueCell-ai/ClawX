# Streamdown Features Reference

## Table of Contents

- [Streaming Mode vs Static Mode](#streaming-mode-vs-static-mode)
- [Carets](#carets)
- [Remend (Incomplete Markdown)](#remend)
- [Interactive Controls](#interactive-controls)
- [GFM Features](#gfm-features)
- [Memoization & Performance](#memoization--performance)
- [Troubleshooting](#troubleshooting)

## Streaming Mode vs Static Mode

**Streaming (default):** Splits markdown into blocks, applies remend, supports carets, memoizes blocks individually.

```tsx
<Streamdown isAnimating={isLoading}>{streamingContent}</Streamdown>
```

**Static:** Renders as single unit, skips streaming optimizations. Use for blog posts, docs, pre-generated content.

```tsx
<Streamdown mode="static">{completeContent}</Streamdown>
```

All props (plugins, components, themes) work in both modes.

## Carets

Visual cursor at end of streaming content.

```tsx
// Block caret (▋) - terminal style
<Streamdown caret="block" isAnimating={isLoading}>{content}</Streamdown>

// Circle caret (●) - subtle style
<Streamdown caret="circle" isAnimating={isLoading}>{content}</Streamdown>
```

**Requirements:** Both `caret` prop AND `isAnimating={true}` must be set. Caret disappears when streaming stops.

**Per-message in chat:**
```tsx
{messages.map((msg, i) => (
  <Streamdown
    key={msg.id}
    caret="block"
    isAnimating={isLoading && i === messages.length - 1 && msg.role === 'assistant'}
  >
    {msg.content}
  </Streamdown>
))}
```

## Remend

Preprocessor that completes incomplete Markdown during streaming.

**What it handles:**
| Pattern | Completion |
|---------|-----------|
| `**text` | `**text**` |
| `*text` | `*text*` |
| `` `code `` | `` `code` `` |
| `~~text` | `~~text~~` |
| `[text` | `[text](streamdown:incomplete-link)` or `text` |
| `![alt` | Removed entirely |
| `$$\n math` | `$$\n math $$` |

**Disable:**
```tsx
<Streamdown parseIncompleteMarkdown={false}>{content}</Streamdown>
```

**Configure:**
```tsx
<Streamdown
  remend={{
    bold: true,
    italic: true,
    links: true,
    images: true,
    inlineCode: true,
    strikethrough: true,
    katex: true,
    linkMode: 'text-only', // 'protocol' | 'text-only'
  }}
>
```

**Custom handlers:**
```tsx
<Streamdown
  remend={{
    handlers: [{
      name: 'custom-syntax',
      handle: (text) => {
        if (text.endsWith('<<')) return text + '>>';
        return null; // Return null to skip
      },
      priority: 100, // Lower = earlier (built-ins use 0-70)
    }],
  }}
>
```

## Interactive Controls

Auto-added buttons for images, tables, code, and Mermaid.

**Disable all:**
```tsx
<Streamdown controls={false}>{markdown}</Streamdown>
```

**Selective:**
```tsx
<Streamdown
  controls={{
    table: true,
    code: false, // No copy/download on code blocks
    mermaid: {
      download: true,
      copy: true,
      fullscreen: true,
      panZoom: false,
    },
  }}
>
```

**Button types by element:**
- **Images:** Download (auto-detected format, alt text as filename)
- **Tables:** Copy (CSV/TSV/HTML), Download (CSV/Markdown)
- **Code blocks:** Copy (raw code), Download (with correct extension)
- **Mermaid:** Copy (source), Download (SVG), Fullscreen, Pan/zoom

All buttons disabled during streaming when `isAnimating={true}`.

## GFM Features

Included by default via `remark-gfm`:

**Tables:**
```markdown
| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |
```

**Task lists:**
```markdown
- [x] Completed
- [ ] Pending
```

**Strikethrough:** `~~deleted~~`

**Autolinks:** URLs and emails auto-linked.

**Footnotes:** `[^1]` reference, `[^1]:` definition.

## Memoization & Performance

- **Component-level:** `React.memo` on Streamdown, re-renders only on children/shikiTheme/isAnimating changes
- **Block-level:** Content split into blocks, each memoized individually
- **Syntax highlighting:** Cached tokens, lazy-loaded languages, shared highlighter instance
- **Plugin arrays:** Created once at module level

## Troubleshooting

### Shiki external package warning (Next.js)
```bash
npm install shiki
```
```js
// next.config.js
{ transpilePackages: ['shiki'] }
```

### Vite SSR CSS loading error
```js
// vite.config.js
{ ssr: { noExternal: ['streamdown'] } }
```

### vscode-jsonrpc bundling errors (Next.js)
```js
// next.config.js
{
  serverComponentsExternalPackages: ['vscode-jsonrpc'],
  webpack: (config) => {
    config.resolve.alias['vscode-jsonrpc'] = false;
    return config;
  },
}
```

### Tailwind styles not applied
Ensure Streamdown dist files are included in Tailwind content scanning. See the Tailwind setup in SKILL.md.
