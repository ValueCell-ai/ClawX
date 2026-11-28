# Local HTML Preview Architecture

ClawX no longer exposes a general-purpose embedded Web Browser. The remaining Electron webview is used only to render an authorized local `.html` or `.htm` file inside the shared Workspace/Preview file surface.

## User flow

- Activating local HTML from an attachment or file activity opens Preview; tree selection retains Workspace and renders in the same shared preview surface.
- The HTML file menu offers the built-in Preview path alongside compatible system applications.
- The Preview header offers one file-level action to open the current HTML through the system browser.
- There is no browser tab, Home page, URL input, navigation history, refresh menu, favicon, cookie/site-data UI, or blank browser entry.

## Link behavior

All links are inert:

- ClawX-rendered Markdown/content links are plain text.
- Inside HTML Preview, Main injects user-origin CSS that removes anchor and area styling and pointer interaction.
- Main also prevents navigation independently, so scripts, forms, synthetic clicks, hash navigation, redirects, and popups cannot bypass the visual restriction.
- Downloads and network requests are canceled.

## Renderer flow

HTML entry points build a scope-specific `FilePreviewTarget`. Conversation entries call `useArtifactPanel.openPreview`; workspace navigation changes the shared focused file without changing the tab. `FilePreviewBody` registers its HTML file, anchor and active state with the reader-owned HTML registry. Workspace and skill readers share this pipeline without changing conversation selection. The anchor owns a `WebBrowserHost` that portals the single selected guest into its reader and asks `hostApi.webBrowser.navigate` to load the selected file.

The host has no browser chrome. It exists only for a registered HTML reader, remains mounted but hidden and inert when that reader switches to Source or becomes inactive, and releases its guest when the reader unmounts. A dialog reader takes precedence over a background reader; removing an obsolete owner cannot clear another reader. The guest belongs to the same DOM and React modal context as its anchor, preserving dialog dismissal and focus boundaries in narrow drawers and skill dialogs. Crash recovery does not restore browsing state.

## Main boundary

`normalizeWebBrowserHtmlFileUrl` accepts only hostless, query-free, fragment-free `file:///` URLs ending in `.html` or `.htm`. The Host API has only:

- `navigate`: load one validated local HTML URL in the registered guest.
- `openExternal`: revalidate the selected local HTML URL, then call `shell.openExternal`; it does not accept web destinations.

Main retains the exact guest identity gate, one-live-guest registry, fixed isolated `persist:clawx-web-browser` partition and User-Agent, sandbox, context isolation, web security, and disabled Node/preload surface.

The dedicated Session denies all permissions, cancels downloads, blocks network protocols, and rejects non-HTML main documents. The guest policy denies all child windows and every guest-initiated top-level or in-page navigation.

## Security consequence

The preview can execute self-contained local HTML scripts for rendering, but it cannot follow links, leave its selected document, request network data, download files, obtain device permissions, or access ClawX/Electron APIs.
