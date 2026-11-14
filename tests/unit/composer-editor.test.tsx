import { createRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNearestEditorFromDOMNode, UNDO_COMMAND, REDO_COMMAND, $getRoot } from 'lexical';
import { ComposerEditor, type ComposerEditorHandle } from '@/components/composer/ComposerEditor';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useComposerDraftStore } from '@/stores/composer-drafts';
import { fillComposer, composerText, selectComposer } from './composer-test-utils';
import type { QuickAccessSkill } from '@/types/skill';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const skills: QuickAccessSkill[] = [{ name: 'docx', description: 'Word files', source: 'workspace', sourceLabel: 'Workspace', manifestPath: '/tmp/docx/SKILL.md', baseDir: '/tmp/docx' }];
function Harness({ editorRef, draftKey, disabled = false, onSend = vi.fn(), onPasteFiles = vi.fn() }: {
  editorRef?: React.Ref<ComposerEditorHandle>; draftKey?: string; disabled?: boolean; onSend?: () => void; onPasteFiles?: (files: File[]) => void;
}) {
  const [local, setLocal] = useState('');
  const draft = useComposerDraftStore(state => draftKey ? state.drafts[draftKey] ?? '' : local);
  return <TooltipProvider><ComposerEditor ref={editorRef} value={draft} draftKey={draftKey} disabled={disabled}
    skills={skills} placeholder="Task" tokenTestId="token" onSend={onSend} onPasteFiles={onPasteFiles}
    onChange={text => { if (draftKey) useComposerDraftStore.getState().setDraft(draftKey, text); else setLocal(text); }} /></TooltipProvider>;
}
beforeEach(() => useComposerDraftStore.setState({ drafts: {}, editorDrafts: {}, attachments: {} }));
describe('Lexical composer', () => {
  it('inserts multiple atomic skills at the selection, keeps text and serializes plain prompts', () => {
    const ref = createRef<ComposerEditorHandle>();
    render(<Harness editorRef={ref} />);
    const input = screen.getByRole('textbox');
    fillComposer(input, 'before after'); selectComposer(input, 7);
    act(() => ref.current!.insertSkill(skills[0]));
    expect(composerText(input)).toBe('before /docx  after');
    act(() => ref.current!.insertSkill(skills[0]));
    expect(screen.getAllByTestId('token')).toHaveLength(2);
    expect(composerText(input)).toBe('before /docx  /docx  after');
  });
  it('makes home insertion idempotent and undoable without clearing the prose', async () => {
    const ref = createRef<ComposerEditorHandle>(); render(<Harness editorRef={ref} />);
    const input = screen.getByRole('textbox'); fillComposer(input, 'my draft');
    act(() => ref.current!.insertSkill(skills[0], true));
    act(() => ref.current!.insertSkill(skills[0], true));
    expect(composerText(input)).toBe('/docx  my draft');
    act(() => { getNearestEditorFromDOMNode(input).dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(composerText(input)).toBe('my draft'));
    act(() => { getNearestEditorFromDOMNode(input).dispatchCommand(REDO_COMMAND, undefined); });
    await waitFor(() => expect(composerText(input)).toBe('/docx  my draft'));
  });
  it('restores skill identity and selection when switching sessions and remounting', () => {
    const ref = createRef<ComposerEditorHandle>();
    const view = render(<Harness editorRef={ref} draftKey="A" />);
    const input = screen.getByRole('textbox'); fillComposer(input, 'before after'); selectComposer(input, 7);
    act(() => ref.current!.insertSkill(skills[0]));
    view.rerender(<Harness editorRef={ref} draftKey="B" />);
    fillComposer(screen.getByRole('textbox'), 'other draft');
    view.rerender(<Harness editorRef={ref} draftKey="A" />);
    expect(composerText(screen.getByRole('textbox'))).toBe('before /docx  after');
    expect(screen.getByTestId('token')).toHaveTextContent('/docx');
    act(() => ref.current!.insertText('here '));
    expect(composerText(screen.getByRole('textbox'))).toBe('before /docx  here after');
    view.unmount(); render(<Harness draftKey="A" />);
    expect(screen.getByTestId('token')).toHaveTextContent('/docx');
  });
  it('imports known legacy tokens without converting paths or unknown skills', () => {
    useComposerDraftStore.getState().setDraft('A', '/docx  line one\n/path/to/file  /unknown  text');
    render(<Harness draftKey="A" />);
    expect(screen.getAllByTestId('token')).toHaveLength(1);
    expect(composerText(screen.getByRole('textbox'))).toBe('/docx  line one\n/path/to/file  /unknown  text');
  });
  it('clears the matching structured draft on an external reset', () => {
    const ref = createRef<ComposerEditorHandle>(); render(<Harness editorRef={ref} draftKey="A" />);
    act(() => ref.current!.insertSkill(skills[0]));
    act(() => useComposerDraftStore.getState().setDraft('A', 'replacement'));
    expect(screen.queryByTestId('token')).not.toBeInTheDocument();
    expect(composerText(screen.getByRole('textbox'))).toBe('replacement');
  });
  it('does not send on IME confirmation and preserves Shift+Enter for multiline input', () => {
    const send = vi.fn(); render(<Harness onSend={send} />);
    const input = screen.getByRole('textbox'); fillComposer(input, '你好');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('locks both editing and imperative insertion when disabled', () => {
    const ref = createRef<ComposerEditorHandle>(); render(<Harness editorRef={ref} disabled />);
    act(() => { ref.current!.insertSkill(skills[0]); ref.current!.insertText('ignored'); });
    expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'false');
    expect(composerText(screen.getByRole('textbox'))).toBe('');
  });
  it('does not share the undo history of different sessions', async () => {
    const ref = createRef<ComposerEditorHandle>();
    const view = render(<Harness editorRef={ref} draftKey="A" />);
    fillComposer(screen.getByRole('textbox'), 'draft A');
    act(() => ref.current!.insertSkill(skills[0]));
    view.rerender(<Harness editorRef={ref} draftKey="B" />);
    fillComposer(screen.getByRole('textbox'), 'draft B');
    view.rerender(<Harness editorRef={ref} draftKey="A" />);
    act(() => { getNearestEditorFromDOMNode(screen.getByRole('textbox')).dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(composerText(screen.getByRole('textbox'))).toBe('draft A'));
    expect(useComposerDraftStore.getState().drafts.B).toBe('draft B');
    expect(getNearestEditorFromDOMNode(screen.getByRole('textbox')).getEditorState().read(() => $getRoot().getTextContent())).toBe('draft A');
  });
});
