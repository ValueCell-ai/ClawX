# Streamdown API Reference

## Table of Contents

- [StreamdownProps](#streamdownprops)
- [PluginConfig](#pluginconfig)
- [RemendOptions](#remendoptions)
- [ControlsConfig](#controlsconfig)
- [LinkSafetyConfig](#linksafetyconfig)
- [MermaidOptions](#mermaidoptions)
- [Default Exports](#default-exports)

## StreamdownProps

```tsx
interface StreamdownProps {
  // Core
  children: string;
  mode?: "streaming" | "static"; // default: "streaming"
  parseIncompleteMarkdown?: boolean; // default: true
  remend?: RemendOptions;
  isAnimating?: boolean; // default: false
  className?: string;

  // Styling
  shikiTheme?: [BundledTheme, BundledTheme]; // default: ['github-light', 'github-dark']
  components?: Components; // Custom element overrides
  allowedTags?: Record<string, string[]>; // Custom HTML tags (only with default rehype plugins)

  // Plugins
  plugins?: PluginConfig;
  rehypePlugins?: Pluggable[]; // default: [rehype-raw, rehype-sanitize, rehype-harden]
  remarkPlugins?: Pluggable[]; // default: [remark-gfm]

  // Element Filtering (react-markdown compatible)
  allowedElements?: string[]; // Tag names to allow (cannot combine with disallowedElements)
  disallowedElements?: string[]; // Tag names to disallow (cannot combine with allowedElements)
  allowElement?: AllowElement; // Custom filter callback
  unwrapDisallowed?: boolean; // default: false — replace disallowed with children
  skipHtml?: boolean; // default: false — ignore raw HTML
  urlTransform?: UrlTransform; // default: defaultUrlTransform — transform/sanitize URLs

  // Features
  caret?: "block" | "circle";
  controls?: ControlsConfig; // default: true
  mermaid?: MermaidOptions;
  linkSafety?: LinkSafetyConfig; // default: { enabled: true }
  cdnUrl?: string | null; // default: 'https://streamdown.ai/cdn'

  // Advanced
  BlockComponent?: React.ComponentType<BlockProps>;
  parseMarkdownIntoBlocksFn?: (markdown: string) => string[];
}
```

## PluginConfig

```tsx
interface PluginConfig {
  code?: CodeHighlighterPlugin;
  mermaid?: DiagramPlugin;
  math?: MathPlugin;
  cjk?: CjkPlugin;
}
```

### CodeHighlighterPlugin (@streamdown/code)

```tsx
import { code } from '@streamdown/code';
import { createCodePlugin } from '@streamdown/code';

const code = createCodePlugin({
  themes: ['github-light', 'github-dark'], // [light, dark]
});

// Methods:
code.highlight(options, callback?);
code.supportsLanguage(language: string): boolean;
code.getSupportedLanguages(): string[];
code.getThemes(): [BundledTheme, BundledTheme];
```

### DiagramPlugin (@streamdown/mermaid)

```tsx
import { mermaid } from '@streamdown/mermaid';
import { createMermaidPlugin } from '@streamdown/mermaid';

const mermaid = createMermaidPlugin({
  config: {
    theme: 'dark', // 'default' | 'dark' | 'forest' | 'neutral' | 'base'
    fontFamily: 'monospace',
  },
});
```

### MathPlugin (@streamdown/math)

```tsx
import { math } from '@streamdown/math';
import { createMathPlugin } from '@streamdown/math';

const math = createMathPlugin({
  singleDollarTextMath: true, // default: false
  errorColor: '#ff0000',
});

math.getStyles(); // Returns "katex/dist/katex.min.css"
```

**Math requires CSS import:**
```tsx
import 'katex/dist/katex.min.css';
```

### CjkPlugin (@streamdown/cjk)

```tsx
import { cjk } from '@streamdown/cjk';
import { createCjkPlugin } from '@streamdown/cjk';

const cjk = createCjkPlugin();
// Provides remarkPluginsBefore and remarkPluginsAfter
```

## RemendOptions

Controls how incomplete Markdown is completed during streaming.

```tsx
interface RemendOptions {
  links?: boolean; // default: true
  images?: boolean; // default: true
  bold?: boolean; // default: true
  italic?: boolean; // default: true
  boldItalic?: boolean; // default: true
  inlineCode?: boolean; // default: true
  strikethrough?: boolean; // default: true
  katex?: boolean; // default: true
  setextHeadings?: boolean; // default: true
  linkMode?: 'protocol' | 'text-only'; // default: 'protocol'
  handlers?: RemendHandler[]; // Custom handlers
}
```

## ControlsConfig

```tsx
type ControlsConfig = boolean | {
  table?: boolean;
  code?: boolean;
  mermaid?: boolean | {
    download?: boolean;
    copy?: boolean;
    fullscreen?: boolean;
    panZoom?: boolean;
  };
};
```

## LinkSafetyConfig

```tsx
interface LinkSafetyConfig {
  enabled: boolean;
  onLinkCheck?: (url: string) => Promise<boolean> | boolean;
  renderModal?: (props: LinkSafetyModalProps) => React.ReactNode;
}

interface LinkSafetyModalProps {
  url: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}
```

## MermaidOptions

```tsx
interface MermaidOptions {
  config?: MermaidConfig;
  errorComponent?: React.ComponentType<MermaidErrorComponentProps>;
}

interface MermaidErrorComponentProps {
  error: string;
  chart: string;
  retry: () => void;
}
```

## Element Filtering Types

```tsx
type AllowElement = (
  element: Readonly<Element>,
  index: number,
  parent: Readonly<Parents> | undefined
) => boolean | null | undefined;

type UrlTransform = (
  url: string,
  key: string,
  node: Readonly<Element>
) => string | null | undefined;
```

### defaultUrlTransform

Passthrough function that returns URLs unchanged. URL security is handled by `rehype-sanitize` and `rehype-harden` instead. Use `urlTransform` when you need custom URL rewriting.

```tsx
import { defaultUrlTransform } from 'streamdown';

defaultUrlTransform('https://example.com', 'href', node); // 'https://example.com'
defaultUrlTransform('/relative/path', 'href', node);      // '/relative/path'
```

## Default Exports

```tsx
import {
  Streamdown,
  defaultUrlTransform,    // URL passthrough (security handled by rehype plugins)
  defaultRemarkPlugins,   // { gfm: [remarkGfm, {}] }
  defaultRehypePlugins,   // { raw: rehypeRaw, sanitize: [rehypeSanitize, {}], harden: [harden, {...}] }
} from 'streamdown';

// Types
import type {
  AllowElement,
  Components,
  ExtraProps,
  UrlTransform,
} from 'streamdown';
```

## Overridable Components

Pass via `components` prop:

| Element | Props |
|---------|-------|
| `h1`-`h6` | children, className, node |
| `p` | children, className, node |
| `strong`, `em` | children, className, node |
| `ul`, `ol` | children, className, node |
| `li` | children, className, node |
| `a` | children, className, href, node |
| `code`, `pre` | children, className, node |
| `blockquote` | children, className, node |
| `table`, `thead`, `tbody`, `tr`, `th`, `td` | children, className, node |
| `img` | src, alt, className, node |
| `hr` | className, node |
| `sup`, `sub` | children, className, node |
| `section` | children, className, node |

## Custom HTML Tags

```tsx
<Streamdown
  allowedTags={{
    source: ["id"],
    mention: ["user_id", "type"],
    widget: ["data*"], // wildcard: all data-* attributes
  }}
  components={{
    source: (props) => <Badge>{props.id}</Badge>,
    mention: (props) => <UserMention userId={props.user_id} />,
  }}
>
  {markdown}
</Streamdown>
```

**Note:** `allowedTags` only works when using default rehype plugins.
