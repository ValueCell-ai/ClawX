import type { Element, Root, RootContent } from 'hast';

// A transport marker for the Chat component, never a navigation destination.
// Using an HTTPS marker lets the unchanged sanitize/harden plugins process the
// rest of the document; native file URLs must never become browser anchors.
const LOCAL_FILE_LINK_PREFIX = 'https://clawx.invalid/__local_file__#';

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isLocalFileReference(value: string): boolean {
  if (!value || value.length > 4096 || hasControlCharacters(value)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (hasControlCharacters(decoded) || decoded.split(/[\\/]/).includes('..')) return false;
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      return /^file:\/\//i.test(value)
        && (!url.hostname || url.hostname.toLowerCase() === 'localhost')
        && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }
  return /^\/(?![\\/])/.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^~\//.test(value);
}

export function localFileReferenceFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(LOCAL_FILE_LINK_PREFIX)) return null;
  try {
    const reference = decodeURIComponent(href.slice(LOCAL_FILE_LINK_PREFIX.length));
    return isLocalFileReference(reference) ? reference : null;
  } catch {
    return null;
  }
}

/** Preserve only explicit local link destinations, never code or bare prose. */
export function rehypeLocalFileLinks() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (node.type === 'element' && node.tagName === 'a') {
        const link = node as Element;
        const href = link.properties.href;
        if (typeof href === 'string' && isLocalFileReference(href)) {
          link.properties.href = LOCAL_FILE_LINK_PREFIX + encodeURIComponent(href);
        }
      }
      if ('children' in node) for (const child of node.children) visit(child);
    };
    visit(tree);
  };
}
