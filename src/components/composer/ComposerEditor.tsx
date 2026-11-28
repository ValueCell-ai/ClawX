import {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect,
  useMemo, useRef, useState, type RefObject,
} from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin, createEmptyHistoryState, type HistoryState } from '@lexical/react/LexicalHistoryPlugin';
import { $generateNodesFromSerializedNodes, $getClipboardDataFromSelection } from '@lexical/clipboard';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode, $createTextNode, $createLineBreakNode, $getRoot, $getSelection, $isRangeSelection,
  $isTextNode, $isParagraphNode, $setSelection, $insertNodes,
  COMMAND_PRIORITY_HIGH, COPY_COMMAND, CUT_COMMAND, PASTE_COMMAND,
  KEY_ENTER_COMMAND, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_BACKSPACE_COMMAND,
  HISTORY_PUSH_TAG, HISTORIC_TAG, SKIP_DOM_SELECTION_TAG,
  type RangeSelection,
} from 'lexical';
import { useTranslation } from 'react-i18next';
import { Popover } from '@/components/ui/popover';
import { hasFloatingSurface } from '@/components/ui/floating-ui';
import { filterQuickAccessSkills } from '@/lib/skill-source-label';
import { useComposerDraftStore } from '@/stores/composer-drafts';
import type { QuickAccessSkill } from '@/types/skill';
import { cn } from '@/lib/utils';
import { ComposerSkillPopoverContent } from './ComposerSkillPopover';
import { SkillNode, $createSkillNode, $isSkillNode } from './SkillNode';

// Lexical history is explicitly mutable and scoped to one live editor/session.
function resetHistory(history: HistoryState) {
  history.current = null;
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
function getSessionHistory(cache: Map<string, HistoryState>, key: string): HistoryState {
  let history = cache.get(key);
  if (!history) { history = createEmptyHistoryState(); cache.set(key, history); }
  return history;
}
const RESTORE = 'clawx-draft-restore';
const NAMESPACE = 'clawx-composer';
export interface ComposerEditorHandle {
  focus(): void;
  insertText(text: string): void;
  insertSkill(skill: Pick<QuickAccessSkill, 'name'>, prepend?: boolean): void;
}
interface Props {
  value: string;
  onChange(value: string): void;
  draftKey?: string;
  skills: QuickAccessSkill[];
  skillsLoading?: boolean;
  skillsError?: string | null;
  onRequestSkills?(): void;
  onPreviewSkill?(name: string): void;
  onSend?(): void;
  onPasteFiles?(files: File[]): void;
  disabled?: boolean;
  readOnly?: boolean;
  suspendSuggestions?: boolean;
  skillMenuAnchorRef?: RefObject<HTMLElement | null>;
  autoFocus?: boolean;
  placeholder: string;
  id?: string;
  testId?: string;
  tokenTestId?: string;
  className?: string;
}

/** Only used to import existing plain-text drafts, never as a typing transform. */
function $importText(value: string, skills: QuickAccessSkill[]) {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);
  for (const [index, line] of value.split('\n').entries()) {
    if (index) paragraph.append($createLineBreakNode());
    const pattern = /(^|\s)\/([^\s/\\:]+) {2}/gu;
    let end = 0;
    for (const match of line.matchAll(pattern)) {
      if (!skills.some(skill => skill.name === match[2])) continue;
      const start = match.index! + match[1].length;
      if (start > end) paragraph.append($createTextNode(line.slice(end, start)));
      paragraph.append($createSkillNode(match[2]), $createTextNode('  '));
      end = match.index! + match[0].length;
    }
    if (end < line.length) paragraph.append($createTextNode(line.slice(end)));
  }
}

const Editor = forwardRef<ComposerEditorHandle, Props>(function Editor(props, ref) {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation(['chat', 'skills']);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const lastSelection = useRef<RangeSelection | null>(null);
  const currentKey = props.draftKey ?? '';
  const [historyByKey] = useState(() => new Map<string, HistoryState>());
  const history = useMemo(() => getSessionHistory(historyByKey, currentKey), [historyByKey, currentKey]);
  const renderedText = useRef<string | undefined>(undefined);
  const activeKey = useRef<string | undefined>(undefined);
  const untouchedImport = useRef(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const dismissedQuery = useRef<string | null>(null);
  const caretAnchor = useRef({ getBoundingClientRect: () => editor.getRootElement()?.getBoundingClientRect() ?? new DOMRect() });
  const listId = useId();
  const matches = useMemo(() => filterQuickAccessSkills(props.skills, query ?? '', t), [props.skills, query, t]);
  const menuOpen = query !== null && !props.disabled && !props.readOnly && !props.suspendSuggestions;
  const menuState = useRef({ open: menuOpen, matches, activeIndex });
  useLayoutEffect(() => { menuState.current = { open: menuOpen, matches, activeIndex }; });

  useLayoutEffect(() => {
    const switching = activeKey.current !== currentKey;
    if (!switching && renderedText.current === props.value) return;
    activeKey.current = currentKey;
    renderedText.current = props.value;
    dismissedQuery.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset suggestions when restoring an external editor document.
    setQuery(null);
    lastSelection.current = null;
    const cached = currentKey ? useComposerDraftStore.getState().editorDrafts[currentKey] : undefined;
    untouchedImport.current = !cached || cached.text !== props.value;
    if (cached?.text === props.value) {
      editor.setEditorState(cached.state, { tag: RESTORE });
    } else {
      resetHistory(history);
      editor.update(() => { $importText(props.value, props.skills); $getRoot().selectEnd(); }, { discrete: true, tag: [RESTORE, HISTORIC_TAG, SKIP_DOM_SELECTION_TAG] });
    }
    if (props.autoFocus && !props.disabled && !hasFloatingSurface()) editor.focus();
  }, [editor, currentKey, props.value, props.skills, props.autoFocus, props.disabled, history]);

  // Catalogs may arrive after a legacy draft. Hydrate it only until the first edit.
  useEffect(() => {
    if (!untouchedImport.current || !props.skills.length) return;
    untouchedImport.current = false;
    editor.update(() => { $importText(latest.current.value, latest.current.skills); $getRoot().selectEnd(); },
      { discrete: true, tag: [RESTORE, HISTORIC_TAG, SKIP_DOM_SELECTION_TAG] });
  }, [editor, props.skills]);
  useEffect(() => {
    editor.setEditable(!props.disabled && !props.readOnly);
    if (props.autoFocus && !props.disabled && !props.readOnly && !hasFloatingSurface()) editor.focus();
  }, [editor, props.disabled, props.readOnly, props.autoFocus]);
  const requestSkills = props.onRequestSkills;
  useEffect(() => { requestSkills?.(); }, [currentKey, requestSkills]);

  const restoreSelection = useCallback(() => {
    if (!$isRangeSelection($getSelection())) {
      if (lastSelection.current) $setSelection(lastSelection.current.clone());
      else $getRoot().selectEnd();
    }
  }, []);
  const insertSkill = useCallback((skill: Pick<QuickAccessSkill, 'name'>, prepend = false, replaceQuery = false) => {
    if (!editor.isEditable()) return;
    editor.update(() => {
      const root = $getRoot();
      if (prepend) {
        if (root.getAllTextNodes().some(node => $isSkillNode(node) && node.__name === skill.name)) { root.selectEnd(); return; }
        const first = root.getFirstChild();
        if ($isParagraphNode(first)) first.selectStart(); else root.selectStart();
      } else restoreSelection();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (replaceQuery) {
        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) return;
        selection.setTextNodeRange(node, 0, node, selection.anchor.offset);
      }
      const before = selection.anchor.getNode();
      const offset = selection.anchor.offset;
      const leadingSpace = $isTextNode(before) && offset > 0 && !/\s/u.test(before.getTextContent()[offset - 1] ?? '');
      const trailing = $createTextNode('  ');
      $insertNodes([...(leadingSpace ? [$createTextNode(' ')] : []), $createSkillNode(skill.name), trailing]);
      trailing.selectEnd();
      if (prepend) root.selectEnd();
    }, { discrete: true, tag: HISTORY_PUSH_TAG });
    setQuery(null);
    editor.focus();
  }, [editor, restoreSelection]);
  useImperativeHandle(ref, () => ({
    focus: () => editor.focus(),
    insertSkill,
    insertText(text) {
      // Dictation may finish while native editing is temporarily read-only.
      if (latest.current.disabled) return;
      editor.update(() => {
        restoreSelection();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertRawText(text);
      }, { discrete: true, tag: HISTORY_PUSH_TAG });
      editor.focus();
    },
  }), [editor, insertSkill, restoreSelection]);

  useEffect(() => editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
    if (activeKey.current !== currentKey) return;
    editorState.read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) lastSelection.current = selection.clone();
      const text = $getRoot().getTextContent();
      if (!tags.has(RESTORE) && (dirtyElements.size || dirtyLeaves.size)) {
        untouchedImport.current = false;
        renderedText.current = text;
        latest.current.onChange(text);
      }
      if (currentKey) useComposerDraftStore.getState().setEditorDraft(currentKey, { text, state: editorState });
      const root = editor.getRootElement();
      for (const element of root?.querySelectorAll<HTMLElement>('[data-clawx-skill]') ?? []) {
        if (latest.current.tokenTestId) element.dataset.testid = latest.current.tokenTestId;
        if (latest.current.onPreviewSkill) {
          element.title = t('composer.skillPreviewTooltip');
          element.classList.add('cursor-pointer', 'hover:underline');
        }
      }
      if (tags.has(RESTORE) || editor.isComposing() || !editor.isEditable() || !root || document.activeElement !== root
        || !$isRangeSelection(selection) || !selection.isCollapsed()) { setQuery(null); return; }
      const node = selection.anchor.getNode();
      const first = $getRoot().getFirstDescendant();
      const prefix = $isTextNode(node) && node === first && !$isSkillNode(node)
        ? node.getTextContent().slice(0, selection.anchor.offset) : '';
      const match = /^\/([^\s/\\:]*)$/u.exec(prefix);
      if (!match) { dismissedQuery.current = null; setQuery(null); return; }
      if (dismissedQuery.current === match[1]) { setQuery(null); return; }
      dismissedQuery.current = null;
      if (!latest.current.skillMenuAnchorRef) {
        const domSelection = window.getSelection();
        if (domSelection?.rangeCount) {
          const range = domSelection.getRangeAt(0).cloneRange();
          caretAnchor.current.getBoundingClientRect = () => range.getBoundingClientRect();
        }
      }
      setQuery(previous => { if (previous !== match[1]) setActiveIndex(0); return match[1]; });
    });
  }), [editor, currentKey, t]);

  useEffect(() => mergeRegister(
    editor.registerCommand(KEY_ENTER_COMMAND, event => {
      if (!event || event.isComposing || event.keyCode === 229 || editor.isComposing()) return false;
      if (event.shiftKey) return false;
      if (menuState.current.open) {
        event.preventDefault();
        const skill = menuState.current.matches[menuState.current.activeIndex];
        if (skill && !latest.current.skillsLoading && !latest.current.skillsError) insertSkill(skill, false, true);
        return true;
      }
      if (latest.current.onSend) { event.preventDefault(); latest.current.onSend(); return true; }
      return false;
    }, COMMAND_PRIORITY_HIGH),
    ...[KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND].map((command, direction) => editor.registerCommand(command, event => {
      if (!menuState.current.open || editor.isComposing()) return false;
      event?.preventDefault();
      const count = menuState.current.matches.length;
      if (count) setActiveIndex(index => (index + (direction === 0 ? 1 : -1) + count) % count);
      return true;
    }, COMMAND_PRIORITY_HIGH)),
    editor.registerCommand(KEY_BACKSPACE_COMMAND, event => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed() || editor.isComposing()) return false;
      const node = selection.anchor.getNode();
      if (!$isTextNode(node) || $isSkillNode(node) || selection.anchor.offset > 2) return false;
      const previous = node.getPreviousSibling();
      if (!$isSkillNode(previous) || !/^ {0,2}$/u.test(node.getTextContent().slice(0, selection.anchor.offset))) return false;
      event?.preventDefault();
      const offset = selection.anchor.offset;
      selection.setTextNodeRange(node, 0, node, offset);
      selection.removeText();
      previous.remove();
      return true;
    }, COMMAND_PRIORITY_HIGH),
    ...[COPY_COMMAND, CUT_COMMAND].map(command => editor.registerCommand(command, event => {
      if (!event || !('clipboardData' in event)) return false;
      const selection = $getSelection();
      if (!selection || selection.isCollapsed()) return false;
      if (!event.clipboardData) return false;
      event.preventDefault();
      const data = $getClipboardDataFromSelection(selection);
      for (const [type, value] of Object.entries(data)) {
        if (value !== undefined) event.clipboardData.setData(type, value);
      }
      if (command === CUT_COMMAND && editor.isEditable() && $isRangeSelection(selection)) selection.removeText();
      return true;
    }, COMMAND_PRIORITY_HIGH)),
    editor.registerCommand(PASTE_COMMAND, event => {
      if (!event || !('clipboardData' in event) || !event.clipboardData) return false;
      const data = event.clipboardData;
      const files = Array.from(data.files);
      if (files.length && latest.current.onPasteFiles) {
        event.preventDefault();
        const selection = $getSelection();
        const text = data.getData('text/plain');
        if (text && $isRangeSelection(selection)) selection.insertRawText(text);
        latest.current.onPasteFiles(files);
        return true;
      }
      const internal = data.getData('application/x-lexical-editor');
      if (!internal) return false;
      try {
        const parsed = JSON.parse(internal);
        if (parsed.namespace !== NAMESPACE || !Array.isArray(parsed.nodes)) return false;
        event.preventDefault();
        $insertNodes($generateNodesFromSerializedNodes(parsed.nodes));
        return true;
      } catch { return false; }
    }, COMMAND_PRIORITY_HIGH),
  ), [editor, insertSkill]);

  const close = () => { dismissedQuery.current = query; setQuery(null); };
  return <>
    <HistoryPlugin externalHistoryState={history} />
    <div className={cn("relative text-base leading-relaxed", props.className?.includes("text-sm") && "text-sm leading-5")}>
      <PlainTextPlugin contentEditable={
        <ContentEditable id={props.id} data-testid={props.testId} role="textbox" aria-multiline="true"
          aria-label={props.placeholder} aria-disabled={props.disabled || undefined} aria-readonly={props.readOnly || undefined}
          aria-autocomplete="list" aria-expanded={menuOpen} aria-controls={menuOpen ? listId : undefined}
          aria-activedescendant={menuOpen && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          className={cn('clawx-composer-editor w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-base leading-relaxed outline-none selection:bg-primary/20', props.className)}
          onClick={event => {
            const token = (event.target as HTMLElement).closest<HTMLElement>('[data-clawx-skill]');
            if (token && props.onPreviewSkill) props.onPreviewSkill(token.dataset.clawxSkill!);
          }} />
      } placeholder={<div aria-hidden="true" className="pointer-events-none absolute inset-0 text-muted-foreground/80">{props.placeholder}</div>}
        ErrorBoundary={LexicalErrorBoundary} />
    </div>
    <Popover open={menuOpen} onOpenChange={open => { if (!open) close(); }} modal={false}>
      <ComposerSkillPopoverContent
        composerRef={props.skillMenuAnchorRef}
        caretAnchor={caretAnchor}
        skills={matches}
        skillsLoading={props.skillsLoading}
        skillsError={props.skillsError}
        optionTestIdPrefix={`${props.testId ?? 'composer'}-slash`}
        navigation={{ listId, activeIndex, onActiveIndexChange: setActiveIndex }}
        onSelectSkill={skill => insertSkill(skill, false, true)}
        data-testid={`${props.testId ?? 'composer'}-slash-menu`}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onFocusOutside={event => { if (editor.getRootElement()?.contains(event.target as Node)) event.preventDefault(); }}
      />
    </Popover>
  </>;
});
export const ComposerEditor = forwardRef<ComposerEditorHandle, Props>(function ComposerEditor(props, ref) {
  const initialConfig = useMemo(() => ({ namespace: NAMESPACE, nodes: [SkillNode], theme: { paragraph: 'm-0', skillTokenTestId: props.tokenTestId },
    onError(error: Error) { throw error; } }), [props.tokenTestId]);
  return <LexicalComposer initialConfig={initialConfig}><Editor {...props} ref={ref} /></LexicalComposer>;
});
