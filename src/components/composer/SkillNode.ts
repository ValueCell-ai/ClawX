import {
  $applyNodeReplacement, TextNode, type EditorConfig, type NodeKey,
  type SerializedTextNode, type Spread, type DOMConversionMap, type DOMExportOutput,
} from 'lexical';

export type SerializedSkillNode = Spread<{ name: string; type: 'clawx-skill'; version: 1 }, SerializedTextNode>;
const validName = (name: unknown): name is string => typeof name === 'string' && /^[^\s/\\:]+$/u.test(name);

/** A real text entity: Lexical owns its caret, selection and atomic deletion. */
export class SkillNode extends TextNode {
  __name: string;
  static getType() { return 'clawx-skill'; }
  static clone(node: SkillNode) { return new SkillNode(node.__name, node.__key); }
  constructor(name: string, key?: NodeKey) {
    super(`/${name}`, key);
    this.__name = name;
  }
  static importJSON(value: SerializedSkillNode): SkillNode {
    if (!validName(value.name)) throw new Error('Invalid skill token');
    return $createSkillNode(value.name);
  }
  exportJSON(): SerializedSkillNode {
    return { ...super.exportJSON(), name: this.__name, type: 'clawx-skill', version: 1 };
  }
  static importDOM(): DOMConversionMap {
    return { span: element => {
      const name = element.getAttribute('data-clawx-skill');
      return validName(name) ? { priority: 2, conversion: () => ({ node: $createSkillNode(name) }) } : null;
    } };
  }
  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.dataset.clawxSkill = this.__name;
    element.textContent = this.getTextContent();
    return { element };
  }
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.dataset.clawxSkill = this.__name;
    element.dataset.skillName = this.__name;
    if (typeof config.theme.skillTokenTestId === 'string') element.dataset.testid = config.theme.skillTokenTestId;
    element.className = 'clawx-skill-token';
    return element;
  }
  updateDOM(previous: this, element: HTMLElement, config: EditorConfig): boolean {
    return super.updateDOM(previous, element, config);
  }
  isTextEntity() { return true; }
  canInsertTextBefore() { return false; }
  canInsertTextAfter() { return false; }
}
export function $createSkillNode(name: string): SkillNode {
  return $applyNodeReplacement(new SkillNode(name)).setMode('token');
}
export function $isSkillNode(node: unknown): node is SkillNode { return node instanceof SkillNode; }
