# Streamdown Security Reference

## Table of Contents

- [Default Security Posture](#default-security-posture)
- [Restricting Protocols](#restricting-protocols)
- [Restricting Links](#restricting-links)
- [Restricting Images](#restricting-images)
- [Link Safety Modal](#link-safety-modal)
- [Custom HTML Tags](#custom-html-tags)
- [Disabling HTML](#disabling-html)
- [Production Config Example](#production-config-example)

## Default Security Posture

Streamdown is permissive by default (all prefixes, protocols, and data images allowed). Security is provided by:

1. **rehype-sanitize** — XSS prevention
2. **rehype-harden** — URL/protocol restriction (all allowed by default)
3. **Link safety modal** — Confirmation before opening external links (enabled by default)

## Restricting Protocols

```tsx
<Streamdown
  rehypePlugins={[
    rehypeRaw,
    [rehypeSanitize, {}],
    [harden, {
      allowedProtocols: ['https', 'mailto'],
      allowedLinkPrefixes: ['*'],
      allowedImagePrefixes: ['*'],
      allowDataImages: true,
    }],
  ]}
>
```

## Restricting Links

Only allow specific domains:

```tsx
[harden, {
  allowedLinkPrefixes: [
    'https://example.com',
    'https://docs.example.com',
  ],
  allowedProtocols: ['https'],
}]
```

## Restricting Images

```tsx
[harden, {
  allowedImagePrefixes: [
    'https://images.example.com',
    'https://cdn.example.com',
  ],
  allowDataImages: false, // Disable data: URLs
}]
```

## Link Safety Modal

**Default:** Enabled. Shows confirmation before opening links.

**Disable:**
```tsx
<Streamdown linkSafety={{ enabled: false }}>{markdown}</Streamdown>
```

**Safelist trusted domains:**
```tsx
<Streamdown
  linkSafety={{
    enabled: true,
    onLinkCheck: async (url) => {
      const trusted = ['example.com', 'docs.example.com'];
      const hostname = new URL(url).hostname;
      return trusted.some((d) => hostname.endsWith(d));
    },
  }}
>
```

**Custom modal:**
```tsx
<Streamdown
  linkSafety={{
    enabled: true,
    renderModal: ({ url, isOpen, onClose, onConfirm }) => (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <p>Open {url}?</p>
          <Button onClick={onConfirm}>Continue</Button>
          <Button onClick={onClose}>Cancel</Button>
        </DialogContent>
      </Dialog>
    ),
  }}
>
```

## Custom HTML Tags

Whitelist specific tags and attributes for AI-generated custom elements:

```tsx
<Streamdown
  allowedTags={{
    source: ["id"],
    mention: ["user_id", "type"],
    widget: ["data*"], // Wildcard: all data-* attributes
  }}
  components={{
    source: (props) => <Badge>{props.id}</Badge>,
    mention: (props) => <UserMention userId={props.user_id} />,
  }}
>
```

**Important:** `allowedTags` only works with default rehype plugins. Custom `rehypePlugins` require custom sanitization.

## URL Transform

Use the `urlTransform` prop for custom URL rewriting. The default `defaultUrlTransform` is a passthrough — URL security is handled by `rehype-sanitize` and `rehype-harden`.

```tsx
import { Streamdown, defaultUrlTransform } from 'streamdown';

// Proxy images through your CDN
<Streamdown
  urlTransform={(url, key, node) => {
    if (key === 'src') {
      return `https://your-cdn.com/proxy?url=${encodeURIComponent(url)}`;
    }
    return defaultUrlTransform(url, key, node);
  }}
>
  {markdown}
</Streamdown>
```

## Skipping HTML

Completely ignore raw HTML in Markdown with `skipHtml`:

```tsx
<Streamdown skipHtml>{markdown}</Streamdown>
```

## Disabling HTML

Remove `rehype-raw` to block all raw HTML:

```tsx
import { defaultRehypePlugins } from 'streamdown';

const { raw, ...rest } = defaultRehypePlugins;

<Streamdown rehypePlugins={Object.values(rest)}>{markdown}</Streamdown>
```

## Production Config Example

Strict config for AI-generated content:

```tsx
<Streamdown
  rehypePlugins={[
    rehypeRaw,
    [rehypeSanitize, {}],
    [harden, {
      allowedProtocols: ['https', 'mailto'],
      allowedLinkPrefixes: ['https://your-domain.com'],
      allowedImagePrefixes: ['https://your-cdn.com'],
      allowDataImages: false,
    }],
  ]}
  linkSafety={{
    enabled: true,
    onLinkCheck: async (url) => {
      const trusted = ['your-domain.com'];
      return trusted.some((d) => new URL(url).hostname.endsWith(d));
    },
  }}
>
  {aiContent}
</Streamdown>
```
