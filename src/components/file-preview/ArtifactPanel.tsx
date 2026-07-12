/**
 * Right-side artifact panel — the WorkBuddy-style split-pane sidebar
 * shown next to the Chat conversation.  Hosts three top-level tabs:
 *
 *   - Workspace (browser): read-only workspace tree + file preview,
 *     scoped to the effective chat workspace.
 *   - Preview: rendered preview of whichever file is currently focused.
 *   - Changes: projected ACP file activity grouped by workspace path.
 *
 * Open/close + tab + focused-file state lives in the
 * `useArtifactPanel` zustand store so any part of the page (file cards,
 * toolbar buttons, "View file changes →" links) can drive it.
 */
import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { Eye, FileEdit, FolderOpen, FolderTree, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supportsRichDocumentPreview } from '@/lib/generated-files';
import { hostApi } from '@/lib/host-api';
import type { AcpSessionFileGroup } from '@/lib/acp/openclaw-file-activities';
import type { AgentSummary } from '@/types/agent';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { getFilePreviewTargetIdentity, type FilePreviewTarget } from './types';
import { FilePreviewBody } from './FilePreviewBody';
import { WorkspaceBrowserBody } from './WorkspaceBrowserBody';
import { WORKSPACE_BROWSER_ENABLED } from './workspace-browser-config';
import { AcpSessionChangesView } from './AcpSessionChangesView';

export interface ArtifactPanelProps {
  fileGroups: AcpSessionFileGroup[];
  uniqueFileCount: number;
  /** Currently selected agent (drives the workspace tab). */
  agent: AgentSummary | null;
  /** Effective chat workspace path resolved from OpenClaw session cwd or global selection. */
  workspacePath?: string | null;
  /** Display label for the effective workspace path. */
  workspaceLabel?: string;
  /** Used to mark "Added this run" badges on the workspace tree. */
  runStartedAt?: number | null;
  /** Bumping this number triggers a workspace tree reload. */
  refreshSignal?: number;
}

export function ArtifactPanel({ fileGroups, uniqueFileCount, agent, workspacePath, workspaceLabel, runStartedAt, refreshSignal }: ArtifactPanelProps) {
  const { t } = useTranslation('chat');
  const isMac = window.electron?.platform === 'darwin';
  const tab = useArtifactPanel((s) => s.tab);
  const setTab = useArtifactPanel((s) => s.setTab);
  const focusedFile = useArtifactPanel((s) => s.focusedFile);
  const focusedChange = useArtifactPanel((s) => s.focusedChange);
  const close = useArtifactPanel((s) => s.close);
  const richFocusedFile = !!focusedFile
    && !focusedFile.workspaceFileRef
    && supportsRichDocumentPreview(focusedFile.ext);
  const requestedTab = !WORKSPACE_BROWSER_ENABLED && tab === 'browser' ? 'changes' : tab;
  const visibleTab = requestedTab;

  const handleRevealFocusedFile = () => {
    if (!focusedFile) return;
    hostApi.shell.showItemInFolder(focusedFile.filePath).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', 'Could not reveal in file manager'));
    });
  };

  return (
    <div data-testid="artifact-panel" className={cn('flex h-full min-h-0 flex-col bg-background', isMac && 'no-drag')}>
      <div className="relative z-30 flex shrink-0 items-center justify-between gap-2 border-b border-black/5 bg-background px-3 py-2 dark:border-white/10">
        {isMac && (
          <div
            data-testid="artifact-panel-drag-region"
            className="drag-region absolute inset-0 z-0"
            aria-hidden="true"
          />
        )}
        <div className={cn('flex min-w-0 items-center gap-1', isMac && 'no-drag relative z-10')}>
          {WORKSPACE_BROWSER_ENABLED && (
            <PanelTabButton
              testId="artifact-panel-tab-browser"
              icon={<FolderTree className="h-3.5 w-3.5" />}
              label={t('artifactPanel.tabs.browser', 'Workspace')}
              active={visibleTab === 'browser'}
              onClick={() => setTab('browser')}
            />
          )}
          <PanelTabButton
            testId="artifact-panel-tab-preview"
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('artifactPanel.tabs.preview', 'Preview')}
            active={visibleTab === 'preview'}
            onClick={() => setTab('preview')}
          />
          <PanelTabButton
            testId="artifact-panel-tab-changes"
            icon={<FileEdit className="h-3.5 w-3.5" />}
            label={t('artifactPanel.tabs.changes', 'Changes')}
            active={visibleTab === 'changes'}
            onClick={() => setTab('changes')}
          />
          {richFocusedFile && (
            <PanelTabButton
              testId="artifact-panel-action-open-folder"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label={t('generatedFiles.openFolder', 'Open folder')}
              active={false}
              onClick={handleRevealFocusedFile}
            />
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7 shrink-0', isMac && 'no-drag relative z-10')}
          onClick={close}
          aria-label={t('filePreview.actions.close', 'Close')}
        >
          <X className="h-4 w-4 pointer-events-none" />
        </Button>
      </div>

      <div className={cn('relative z-0 min-h-0 flex-1 overflow-hidden', isMac && 'no-drag')}>
        {WORKSPACE_BROWSER_ENABLED && (
          <div className={cn('h-full min-h-0', visibleTab !== 'browser' && 'hidden')}>
            <WorkspaceBrowserBody
              agent={agent}
              workspacePath={workspacePath}
              workspaceLabel={workspaceLabel}
              runStartedAt={runStartedAt}
              refreshSignal={refreshSignal}
              compact
            />
          </div>
        )}
        <div className={cn('h-full min-h-0', visibleTab !== 'preview' && 'hidden')}>
          <PreviewTab focusedFile={focusedFile} />
        </div>
        <div className={cn('h-full min-h-0', visibleTab !== 'changes' && 'hidden')}>
          <AcpSessionChangesView fileGroups={fileGroups} uniqueFileCount={uniqueFileCount} focus={focusedChange} />
        </div>
      </div>
    </div>
  );
}

interface PanelTabButtonProps {
  testId?: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function PanelTabButton({ testId, icon, label, active, onClick }: PanelTabButtonProps) {
  const pointerActivated = useRef(false);

  return (
    <button
      data-testid={testId}
      type="button"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pointerActivated.current = true;
        event.preventDefault();
        onClick();
      }}
      onClick={() => {
        if (pointerActivated.current) {
          pointerActivated.current = false;
          return;
        }
        onClick();
      }}
      className={cn(
        'relative z-40 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface PreviewTabProps {
  focusedFile: FilePreviewTarget | null;
}

function PreviewTab({ focusedFile }: PreviewTabProps) {
  const { t } = useTranslation('chat');
  if (!focusedFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-foreground">
          {t('artifactPanel.preview.emptyTitle', 'No file selected')}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {t(
            'artifactPanel.preview.emptyHint',
            'Click a file card in the conversation to open the sidebar and select a file first.',
          )}
        </p>
      </div>
    );
  }
  return (
    <FilePreviewBody
      key={getFilePreviewTargetIdentity(focusedFile)}
      file={focusedFile}
      compact
      mode="preview"
    />
  );
}

export default ArtifactPanel;
