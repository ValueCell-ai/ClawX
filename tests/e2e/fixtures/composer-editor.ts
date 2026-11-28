import type { Locator } from '@playwright/test';

export async function composerCaretOffset(input: Locator): Promise<number> {
  return input.evaluate(element => {
    const selection = window.getSelection();
    if (!selection?.anchorNode || !element.contains(selection.anchorNode)) return -1;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().length;
  });
}
export async function setComposerCaret(input: Locator, offset: number): Promise<void> {
  await input.evaluate((element, offset) => {
    (element as HTMLElement).focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0;
      if (offset <= length) {
        const range = document.createRange(); range.setStart(node, offset); range.collapse(true);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }
      offset -= length;
    }
  }, offset);
}
