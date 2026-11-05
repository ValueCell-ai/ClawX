import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Streamdown } from 'streamdown';
import { chatStreamdownRehypePlugins } from '@/components/markdown/streamdown-config';
import { localFileReferenceFromHref } from '@/lib/markdown-file-links';
import { AcpRenderPart } from '@/pages/Chat/AcpMessageSegment';

const { state, resolveAttachment, openAttachment, openPreview, error } = vi.hoisted(() => ({
  state: { activeSessionKey: 'agent:main:test', generation: 3, loading: false },
  resolveAttachment: vi.fn(),
  openAttachment: vi.fn(),
  openPreview: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/stores/acp-chat-session', () => ({ useAcpChatSessionStore: { getState: () => state } }));
vi.mock('@/stores/artifact-panel', () => ({ useArtifactPanel: { getState: () => ({ openPreview }) } }));
vi.mock('@/lib/host-api', () => ({ hostApi: { files: { resolveAttachment, openAttachment } } }));
vi.mock('sonner', () => ({ toast: { error } }));

const uri = 'file:///tmp/report%20one.md';
const available = () => ({
  ok: true,
  identity: 'opaque-file',
  displayName: 'report one.md',
  mimeType: 'text/markdown',
  size: 30,
  target: {
    kind: 'local', scope: 'openclaw-media', entryKind: 'file',
    ref: { sessionKey: state.activeSessionKey, generation: state.generation, uri },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { activeSessionKey: 'agent:main:test', generation: 3, loading: false });
  resolveAttachment.mockResolvedValue(available());
  openAttachment.mockResolvedValue({ ok: true });
});

function renderMarkdown(text: string) {
  return render(<AcpRenderPart tone="assistant" part={{ kind: 'markdown', text }} />);
}

describe('Chat Markdown local files', () => {
  it.each([
    uri, 'file://localhost/tmp/report.md', '/tmp/report.md', '~/reports/report.md', 'C:/reports/report.md',
  ])('preserves an explicit %s link without making a file anchor', (path) => {
    const { container } = renderMarkdown(`[Report](${path})`);
    expect(screen.getByRole('button', { name: 'Report' })).toHaveAttribute('title', path);
    expect(container).not.toHaveTextContent('[blocked]');
    expect(container.querySelector('a')).toBeNull();
    expect(resolveAttachment).not.toHaveBeenCalled();
  });

  it('leaves code, bare paths, HTML, and web links inert', () => {
    const { container } = renderMarkdown([
      `[Report](${uri})`, '',
      `\`[Example](${uri})\``, '',
      '```markdown', `[Fenced](${uri})`, '```', '',
      uri, '', '[Docs](https://example.com)', '', '<script>alert(1)</script>',
    ].join('\n'));
    expect(screen.getAllByTestId('acp-markdown-file-link')).toHaveLength(1);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
    expect(resolveAttachment).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert%281%29', 'data:text/html,evil', 'file://server/share/report.md',
    'file:///tmp/%00report.md', 'file:///tmp/%2e%2e/secret', 'file:///tmp/report.md?query=1',
  ])('does not project unsafe or remote destinations: %s', (path) => {
    renderMarkdown(`[Unsafe](${path})`);
    expect(screen.queryByTestId('acp-markdown-file-link')).toBeNull();
    expect(resolveAttachment).not.toHaveBeenCalled();
  });

  it('rejects forged invalid internal markers', () => {
    expect(localFileReferenceFromHref('https://clawx.invalid/__local_file__#javascript%3Aalert(1)')).toBeNull();
    expect(localFileReferenceFromHref('https://clawx.invalid/__local_file__#%')).toBeNull();
  });

  it('opens Preview only after click and resolution with the current session and generation', async () => {
    renderMarkdown(`[Report](${uri})`);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    await waitFor(() => expect(openPreview).toHaveBeenCalledOnce());
    expect(resolveAttachment).toHaveBeenCalledWith({ ref: { sessionKey: 'agent:main:test', generation: 3, uri } });
    expect(openPreview).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'report one.md',
      attachmentFileRef: { sessionKey: 'agent:main:test', generation: 3, uri },
    }));
    expect(openAttachment).not.toHaveBeenCalled();
  });

  it('opens directories through scoped system open instead of Preview', async () => {
    resolveAttachment.mockResolvedValue({ ...available(), target: { ...available().target, entryKind: 'directory' } });
    renderMarkdown(`[Folder](${uri})`);
    fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
    await waitFor(() => expect(openAttachment).toHaveBeenCalledWith(available().target.ref));
    expect(openPreview).not.toHaveBeenCalled();
  });

  it('shows an unavailable error when Main rejects the file', async () => {
    resolveAttachment.mockResolvedValue({ ok: false, displayName: 'report.md', error: 'unavailable' });
    renderMarkdown(`[Report](${uri})`);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    await waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(openPreview).not.toHaveBeenCalled();
    expect(openAttachment).not.toHaveBeenCalled();
  });

  it.each(['session', 'generation', 'loading'])('drops pending results after %s changes', async (change) => {
    let complete!: (value: ReturnType<typeof available>) => void;
    resolveAttachment.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    renderMarkdown(`[Report](${uri})`);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    await waitFor(() => expect(resolveAttachment).toHaveBeenCalledOnce());
    if (change === 'session') state.activeSessionKey = 'agent:main:other';
    if (change === 'generation') state.generation += 1;
    if (change === 'loading') state.loading = true;
    await act(async () => { complete(available()); });
    expect(openPreview).not.toHaveBeenCalled();
    expect(openAttachment).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps dangerous URLs filtered with the unchanged default hardening', () => {
    const { container } = render(
      <Streamdown mode="static" rehypePlugins={chatStreamdownRehypePlugins}>
        {'[Unsafe](javascript:alert%281%29)'}
      </Streamdown>,
    );
    expect(container).toHaveTextContent('[blocked]');
    expect(container.querySelector('a')).toBeNull();
  });

  it('does not open a preview after leaving Chat while resolution is pending', async () => {
    let complete!: (value: ReturnType<typeof available>) => void;
    resolveAttachment.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const view = renderMarkdown(`[Report](${uri})`);
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    await waitFor(() => expect(resolveAttachment).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { complete(available()); });
    expect(openPreview).not.toHaveBeenCalled();
    expect(openAttachment).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
