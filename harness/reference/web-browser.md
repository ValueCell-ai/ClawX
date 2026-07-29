# Local HTML Preview Architecture

ClawX no longer exposes a general-purpose embedded Web Browser. The remaining Electron webview is used only to render an authorized local `.html` or `.htm` file inside the existing Preview tab.

## User flow

- Activating local HTML from an attachment, file activity, or Workspace opens Preview.
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

HTML entry points build an ordinary `FilePreviewTarget` and call `useArtifactPanel.openPreview`. `FilePreviewBody` renders an HTML anchor in Preview. The route-stable host in `MainLayout` overlays one webview on that anchor and asks `hostApi.webBrowser.navigate` to load the selected file.

The host has no browser chrome. It exists only for an HTML `focusedFile`, remains hidden and inert when Preview is not visible, and can recover a crashed guest without restoring browsing state.

## Main boundary

`normalizeWebBrowserHtmlFileUrl` accepts only hostless, query-free, fragment-free `file:///` URLs ending in `.html` or `.htm`. The Host API has only:

- `navigate`: load one validated local HTML URL in the registered guest.
- `openExternal`: revalidate the selected local HTML URL, then call `shell.openExternal`; it does not accept web destinations.

Main retains the exact guest identity gate, one-live-guest registry, fixed isolated `persist:clawx-web-browser` partition and User-Agent, sandbox, context isolation, web security, and disabled Node/preload surface.

The dedicated Session denies all permissions, cancels downloads, blocks network protocols, and rejects non-HTML main documents. The guest policy denies all child windows and every guest-initiated top-level or in-page navigation.

## Security consequence

The preview can execute self-contained local HTML scripts for rendering, but it cannot follow links, leave its selected document, request network data, download files, obtain device permissions, or access ClawX/Electron APIs.
