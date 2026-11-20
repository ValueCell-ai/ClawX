import { act } from '@testing-library/react';
import { $getRoot, $createParagraphNode, $createTextNode, $createLineBreakNode, getNearestEditorFromDOMNode } from 'lexical';

// jsdom has no layout; real caret geometry is exercised in Electron E2E.
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;

export function fillComposer(element: HTMLElement, text: string) {
  act(() => getNearestEditorFromDOMNode(element).update(() => {
    const root = $getRoot(); root.clear();
    const paragraph = $createParagraphNode(); root.append(paragraph);
    for (const [index, line] of text.split('\n').entries()) {
      if (index) paragraph.append($createLineBreakNode());
      if (line) paragraph.append($createTextNode(line));
    }
    root.selectEnd();
  }, { discrete: true }));
}
export function composerText(element: HTMLElement): string {
  return getNearestEditorFromDOMNode(element).getEditorState().read(() => $getRoot().getTextContent());
}
export function selectComposer(element: HTMLElement, start: number, end = start, afterSelect?: () => void) {
  act(() => getNearestEditorFromDOMNode(element).update(() => {
    const nodes = $getRoot().getAllTextNodes();
    let offset = 0;
    const point = (position: number) => {
      offset = 0;
      for (const node of nodes) {
        const length = node.getTextContentSize();
        if (position <= offset + length) return { node, offset: position - offset };
        offset += length;
      }
      return { node: nodes.at(-1)!, offset: nodes.at(-1)?.getTextContentSize() ?? 0 };
    };
    if (!nodes.length) { $getRoot().selectEnd(); return; }
    const anchor = point(start), focus = point(end);
    anchor.node.select(anchor.offset, anchor.offset).setTextNodeRange(anchor.node, anchor.offset, focus.node, focus.offset);
    afterSelect?.();
  }, { discrete: true }));
}
