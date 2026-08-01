# Streamdown Styling Reference

## Table of Contents

- [CSS Variables](#css-variables)
- [Data Attribute Selectors](#data-attribute-selectors)
- [Custom Components](#custom-components)
- [Scoped Styling](#scoped-styling)
- [Theme Examples](#theme-examples)
- [Styling Priority](#styling-priority)

## CSS Variables

Streamdown uses shadcn/ui CSS variables. Override in `globals.css`:

```css
@layer base {
  :root {
    --primary: 222.2 47.4% 11.2%;        /* Links, accents */
    --primary-foreground: 210 40% 98%;    /* Text on primary */
    --muted: 210 40% 96.1%;              /* Code blocks, table headers */
    --muted-foreground: 215.4 16.3% 46.9%; /* Blockquote text */
    --border: 214.3 31.8% 91.4%;         /* Tables, rules, code blocks */
    --ring: 222.2 84% 4.9%;              /* Focus rings */
    --radius: 0.5rem;                     /* Border radius */
  }

  .dark {
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --border: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}
```

## Data Attribute Selectors

Target specific elements via `[data-streamdown="..."]`:

```css
/* Headings */
[data-streamdown="heading-1"] { }
[data-streamdown="heading-2"] { }
[data-streamdown="heading-3"] { }
[data-streamdown="heading-4"] { }
[data-streamdown="heading-5"] { }
[data-streamdown="heading-6"] { }

/* Text */
[data-streamdown="strong"] { }
[data-streamdown="link"] { }
[data-streamdown="inline-code"] { }

/* Lists */
[data-streamdown="ordered-list"] { }
[data-streamdown="unordered-list"] { }
[data-streamdown="list-item"] { }

/* Blocks */
[data-streamdown="blockquote"] { }
[data-streamdown="horizontal-rule"] { }

/* Code */
[data-streamdown="code-block"] { }
[data-streamdown="mermaid-block"] { }

/* Tables */
[data-streamdown="table-wrapper"] { }
[data-streamdown="table"] { }
[data-streamdown="table-header"] { }
[data-streamdown="table-body"] { }
[data-streamdown="table-row"] { }
[data-streamdown="table-header-cell"] { }
[data-streamdown="table-cell"] { }
[data-streamdown="table-fullscreen"] { }

/* Other */
[data-streamdown="superscript"] { }
[data-streamdown="subscript"] { }
```

## Custom Components

Override any Markdown element via the `components` prop:

```tsx
<Streamdown
  components={{
    h1: ({ children, ...props }) => (
      <h1 className="text-4xl font-bold" {...props}>{children}</h1>
    ),
    a: ({ children, href, ...props }) => (
      <a href={href} className="text-blue-500 hover:underline" {...props}>
        {children}
      </a>
    ),
    code: ({ children, className, ...props }) => {
      const isInline = !className;
      if (isInline) {
        return <code className="bg-gray-100 rounded px-1" {...props}>{children}</code>;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  }}
>
  {markdown}
</Streamdown>
```

**Available elements:** h1-h6, p, strong, em, ul, ol, li, a, code, pre, blockquote, table, thead, tbody, tr, th, td, img, hr, sup, sub, section

## Scoped Styling

Use `className` prop for instance-specific styles:

```tsx
<Streamdown className="docs-content">{markdown}</Streamdown>
```

```css
.docs-content [data-streamdown="heading-1"] {
  font-family: 'Inter', sans-serif;
}
.docs-content [data-streamdown="code-block"] {
  font-family: 'Fira Code', monospace;
}
```

## Theme Examples

**Minimal Gray:**
```css
:root {
  --primary: 0 0% 20%;
  --muted: 0 0% 96%;
  --border: 0 0% 90%;
  --radius: 0.25rem;
}
```

**Vibrant Blue:**
```css
:root {
  --primary: 217 91% 60%;
  --muted: 214 100% 97%;
  --border: 214 32% 91%;
  --radius: 0.75rem;
}
```

**No Borders:**
```css
:root {
  --border: transparent;
  --muted: 0 0% 98%;
  --radius: 0rem;
}
```

## Styling Priority

1. **Custom Components** — Complete control over rendering
2. **CSS via `data-streamdown` selectors** — Element-specific styling
3. **CSS Variables** — Global theme tokens
