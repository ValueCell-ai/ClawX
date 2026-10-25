/** Shared workspace, preview and current-session file-activity panel. */
import { Eye, FileEdit, FolderTree, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AcpSessionFileGroup } from '@/lib/acp/openclaw-file-activities';
import type { AgentSummary } from '@/types/agent';
import { useArtifactPanel, type ArtifactTab } from '@/stores/artifact-panel';
import { WorkspaceBrowserBody } from './WorkspaceBrowserBody';
import { FilePreviewSurface } from './FilePreviewSurface';
import { WORKSPACE_BROWSER_ENABLED } from './workspace-browser-config';
import { AcpSessionChangesView } from './AcpSessionChangesView';

export interface ArtifactPanelProps {
  fileGroups: AcpSessionFileGroup[];
  uniqueFileCount: number;
  agent: AgentSummary | null;
  workspacePath?: string | null;
  workspaceLabel?: string;
  runStartedAt?: number | null;
  refreshSignal?: number;
}

export function ArtifactPanel({ fileGroups, uniqueFileCount, agent, workspacePath, workspaceLabel, runStartedAt, refreshSignal }: ArtifactPanelProps) {
  const { t } = useTranslation('chat');
  const tab = useArtifactPanel(state => state.tab);
  const setTab = useArtifactPanel(state => state.setTab);
  const focusedFile = useArtifactPanel(state => state.focusedFile);
  const focusedChange = useArtifactPanel(state => state.focusedChange);
  const close = useArtifactPanel(state => state.close);
  const visibleTab = !WORKSPACE_BROWSER_ENABLED && tab === 'browser' ? 'changes' : tab;
  const isMac = window.electron?.platform === 'darwin';
  return (
    <Tabs value={visibleTab} onValueChange={value => setTab(value as ArtifactTab)} data-testid="artifact-panel" className={cn('flex h-full min-h-0 flex-col bg-background', isMac && 'no-drag')}>
      <div className="relative z-30 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        {isMac && <div data-testid="artifact-panel-drag-region" className="drag-region absolute inset-0 z-0" aria-hidden />}
        <TabsList data-testid="artifact-panel-tabs" aria-label={t('workspace.title')} className="no-drag relative z-10 h-8 min-w-0 justify-start gap-0.5 overflow-x-auto rounded-lg bg-transparent p-0">
          {WORKSPACE_BROWSER_ENABLED && <TabsTrigger value="browser" id="artifact-tab-browser" aria-controls="artifact-files-panel" data-testid="artifact-panel-tab-browser" className="h-7 shrink-0 gap-1.5 rounded-lg px-2 py-1 text-xs data-[state=active]:bg-black/5 data-[state=active]:shadow-none dark:data-[state=active]:bg-white/10"><FolderTree className="h-3.5 w-3.5" />{t('artifactPanel.tabs.browser')}</TabsTrigger>}
          <TabsTrigger value="preview" id="artifact-tab-preview" aria-controls="artifact-files-panel" data-testid="artifact-panel-tab-preview" className="h-7 shrink-0 gap-1.5 rounded-lg px-2 py-1 text-xs data-[state=active]:bg-black/5 data-[state=active]:shadow-none dark:data-[state=active]:bg-white/10"><Eye className="h-3.5 w-3.5" />{t('artifactPanel.tabs.preview')}</TabsTrigger>
          <TabsTrigger value="changes" id="artifact-tab-changes" aria-controls="artifact-changes-panel" data-testid="artifact-panel-tab-changes" className="h-7 shrink-0 gap-1.5 rounded-lg px-2 py-1 text-xs data-[state=active]:bg-black/5 data-[state=active]:shadow-none dark:data-[state=active]:bg-white/10"><FileEdit className="h-3.5 w-3.5" />{t('artifactPanel.tabs.changes')}<span className="rounded-md bg-black/5 px-1.5 text-2xs tabular-nums text-muted-foreground dark:bg-white/10" data-testid="artifact-panel-changes-count">{uniqueFileCount}</span></TabsTrigger>
        </TabsList>
        <Button variant="ghost" size="icon" className="no-drag relative z-10 h-7 w-7 shrink-0" onClick={close} aria-label={t('filePreview.actions.close')} title={t('filePreview.actions.close')}><X className="h-4 w-4" /></Button>
      </div>
      <div className="no-drag relative z-0 min-h-0 flex-1 overflow-hidden">
        {WORKSPACE_BROWSER_ENABLED ? (
          <div id="artifact-files-panel" hidden={visibleTab === 'changes'} role="tabpanel" aria-labelledby={visibleTab === 'browser' ? 'artifact-tab-browser' : 'artifact-tab-preview'} className={cn('h-full min-h-0', visibleTab === 'changes' && 'hidden')}>
            <WorkspaceBrowserBody agent={agent} workspacePath={workspacePath} workspaceLabel={workspaceLabel} runStartedAt={runStartedAt} refreshSignal={refreshSignal} active={visibleTab !== 'changes'} previewOnly={visibleTab === 'preview'} fileGroups={fileGroups} compact />
          </div>
        ) : (
          <div className={cn('h-full min-h-0', visibleTab !== 'preview' && 'hidden')}><FilePreviewSurface file={focusedFile} active={visibleTab === 'preview'} /></div>
        )}
        <div id="artifact-changes-panel" role="tabpanel" aria-labelledby="artifact-tab-changes" hidden={visibleTab !== 'changes'} className="m-0 h-full">
          <AcpSessionChangesView fileGroups={fileGroups} uniqueFileCount={uniqueFileCount} focus={focusedChange} onBrowse={WORKSPACE_BROWSER_ENABLED ? () => setTab('browser') : undefined} />
        </div>
      </div>
    </Tabs>
  );
}
export default ArtifactPanel;
