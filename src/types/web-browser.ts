import type { WebviewTag } from 'electron';

interface HTMLWebViewElement extends HTMLElement {
  readonly tagName: 'WEBVIEW';
}

export type WebBrowserWebviewElement = HTMLWebViewElement & WebviewTag;
