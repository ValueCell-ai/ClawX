import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, FileText, FolderOpen, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ModelPicker } from '@/components/common/ModelPicker';
import type { FilePreviewTarget } from '@/components/file-preview/types';
import { hostApi, type ChannelGroupItem } from '@/lib/host-api';
import { readTextFile, writeTextFile } from '@/lib/file-preview-client';
import type { AgentWorkspaceSnapshot } from '@/lib/agent-workspace';
import { ChannelLogo } from '@/components/channels/ChannelLogo';
import { splitModelRef } from '@/lib/model-options';
import { useAgentsStore } from '@/stores/agents';
import { useAgentModels } from './use-agent-models';
import { ModelFallbackEditor } from './ModelFallbackEditor';
import { CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';

const FileReader = lazy(() => import('@/components/file-preview/FilePreviewOverlay'));
const fileLabels: Record<string, string> = { 'AGENTS.md': 'rules', 'USER.md': 'user', 'IDENTITY.md': 'identity', 'MEMORY.md': 'memory' };

export function AgentDetails({ open, agent, workspace, channelGroups, onClose, onReturnFocus, onWorkspaceSaved }: {
  open: boolean;
  agent: AgentSummary;
  workspace?: AgentWorkspaceSnapshot;
  channelGroups: ChannelGroupItem[];
  onClose: () => void;
  onReturnFocus: () => void;
  onWorkspaceSaved: () => void;
}) {
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const { updateAgent, updateAgentModel, updateFallbacks, defaultModelFallbacks } = useAgentsStore();
  const modelOptions = useAgentModels();
  const [tab, setTab] = useState('overview');
  const [name, setName] = useState(agent.name);
  const [savingOverview, setSavingOverview] = useState(false);
  // Null means the existing OpenClaw configuration has not been edited.
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState<string[] | null | undefined>(undefined);
  const [editingStyle, setEditingStyle] = useState(false);
  const [styleDraft, setStyleDraft] = useState('');
  const styleBaseRef = useRef('');
  const latestStyleRef = useRef('');
  const [styleConflict, setStyleConflict] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const pendingNavigation = useRef<(() => void) | undefined>(undefined);
  const [file, setFile] = useState<FilePreviewTarget | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const fileTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { setName(agent.name); }, [agent.name]);
  const nameChanged = name.trim() !== agent.name;
  const modelChanged = modelDraft !== null && modelDraft !== agent.modelRef;
  const selectedModel = modelDraft ?? agent.modelRef ?? null;
  const fallbackChanged = fallbackDraft !== undefined;
  const originallyInherited = !agent.overrideModelRef;
  const inheritedFallbacks = !agent.overrideModelRef && !modelChanged;
  const fallbackValue = fallbackDraft === undefined ? (agent.modelFallbacks ?? (originallyInherited ? defaultModelFallbacks : [])) : (fallbackDraft ?? (inheritedFallbacks ? defaultModelFallbacks : []));
  const styleChanged = editingStyle && styleDraft !== styleBaseRef.current;
  const busy = savingOverview || savingStyle;
  const finishClose = (action?: () => void) => { onClose(); action?.(); };
  const requestClose = (action?: () => void) => {
    if (busy) return;
    pendingNavigation.current = action;
    if (nameChanged || modelChanged || fallbackChanged || styleChanged) setConfirmClose(true);
    else finishClose(action);
  };
  const openFile = (target: FilePreviewTarget, trigger: HTMLButtonElement) => { fileTriggerRef.current = trigger; setFile(target); setReaderOpen(true); };
  const soulFile = workspace?.files.find(file => file.fileName === 'SOUL.md');
  const remainingFiles = workspace?.files.filter(file => file.fileName !== 'SOUL.md') ?? [];
  const hasMemory = remainingFiles.some(file => file.fileName === 'MEMORY.md' || /\d{4}-\d{2}-\d{2}/.test(file.fileName));
  const boundAccounts = channelGroups.flatMap(group => group.accounts.filter(account => account.agentId === agent.id).map(account => ({ ...account, channelType: group.channelType, channelName: CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType })));
  const saveOverview = async () => {
    if (busy || !name.trim() || (!nameChanged && !modelChanged && !fallbackChanged)) return;
    if (modelChanged && !splitModelRef(modelDraft)) { toast.error(t('toast.agentModelInvalid')); return; }
    setSavingOverview(true);
    let field: 'name' | 'model' | 'fallback' = 'name';
    let nameSaved = false;
    try {
      if (nameChanged) { await updateAgent(agent.id, name.trim()); nameSaved = true; }
      field = 'model';
      if (modelChanged && modelDraft) await updateAgentModel(agent.id, modelDraft);
      field = 'fallback';
      if (fallbackChanged) await updateFallbacks(agent.id, fallbackDraft ?? null);
      toast.success(t('toast.agentUpdated'));
      // A separate SOUL.md draft cannot be committed with these settings.
      if (styleChanged) setTab('profile');
      else onClose();
    } catch (error) {
      const key = field === 'name' ? 'toast.agentUpdateFailed' : nameSaved || (field === 'fallback' && modelChanged) ? 'toast.agentOverviewPartialSave' : field === 'fallback' ? 'fallbacks.saveFailed' : 'toast.agentModelUpdateFailed';
      toast.error(t(key, { error: String(error) }));
    } finally {
      setSavingOverview(false);
    }
  };
  const saveStyle = async () => {
    if (!soulFile || !styleChanged || busy) return;
    setSavingStyle(true);
    try {
      const latest = await readTextFile(soulFile.filePath);
      if (!latest.ok) throw new Error(latest.error);
      if (latest.content !== styleBaseRef.current) { latestStyleRef.current = latest.content ?? ''; setStyleConflict(true); onWorkspaceSaved(); toast.error(t('profile.fileChanged')); return; }
      const result = await writeTextFile(soulFile.filePath, styleDraft);
      if (!result.ok) throw new Error(result.error);
      setEditingStyle(false);
      onWorkspaceSaved();
      toast.success(t('profile.styleSaved'));
    } catch (error) { toast.error(t('profile.styleSaveFailed', { error: String(error) })); }
    finally { setSavingStyle(false); }
  };
  const openWorkspace = async () => {
    try {
      const error = await hostApi.shell.openPath(agent.workspace);
      if (error) toast.error(t('profile.openFolderFailed'));
    } catch {
      toast.error(t('profile.openFolderFailed'));
    }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next) requestClose(); }}>
    <DialogContent data-testid="agent-detail-dialog" className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl bg-surface-modal p-0" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-5 pr-14">
        <div className="min-w-0"><DialogTitle className="truncate font-sans text-xl font-medium tracking-normal">{agent.name}</DialogTitle><DialogDescription className="mt-1 text-sm text-muted-foreground">{agent.isDefault ? t('detailTabs.defaultAssistant') : t('settingsDialog.agentIdLabel') + ': ' + agent.id}</DialogDescription></div>
      </div>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8" disabled={busy} aria-label={t('profile.close')} onClick={() => requestClose()}><X className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent side="left">{t('profile.close')}</TooltipContent></Tooltip>
      <Suspense fallback={null}><FileReader file={file} open={open && readerOpen} onClose={() => setReaderOpen(false)} onReturnFocus={() => fileTriggerRef.current?.focus()} testId="agent-file-reader" /></Suspense>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList variant="page" className="mx-6 mb-1 mt-3 shrink-0" aria-label={t('settingsDialog.title', { name: agent.name })}>
          {(['overview', 'profile'] as const).map(value => <TabsTrigger key={value} variant="page" value={value} disabled={busy} data-testid={`agent-tab-${value}`}>{t(`detailTabs.${value}`)}</TabsTrigger>)}
        </TabsList>
        <div data-testid="agent-detail-content" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          <TabsContent value="overview" className="m-0">
            <div className="space-y-4">
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:gap-3">
                <Label htmlFor="agent-settings-name" className="text-sm font-medium text-foreground sm:pt-2">{t('settingsDialog.nameLabel')}</Label>
                <Input id="agent-settings-name" value={name} onChange={event => setName(event.target.value)} className="h-9 min-w-0 bg-surface-modal font-sans text-foreground" maxLength={120} disabled={busy} />
              </div>
              <section className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:gap-3" aria-labelledby="agent-model-title">
                <span id="agent-model-title" className="text-sm font-medium text-foreground sm:pt-2">{t('settingsDialog.modelLabel')}</span>
                <div className="min-w-0 space-y-2">
                  <div data-testid="agent-model-select"><ModelPicker options={modelOptions} value={selectedModel} label={modelOptions.find(option => option.modelRef === selectedModel)?.modelId || selectedModel || t('profile.notConfigured')}
                    title={t('settingsDialog.modelLabel')} valueTitle={selectedModel || undefined} providerLabel={t('settingsDialog.modelProviderLabel')} labelledBy="agent-model-title" testIdPrefix="agent-model-picker"
                    onValueChange={value => setModelDraft(value === agent.modelRef ? null : value)} disabled={busy} side="bottom" align="start"
                    className="h-9 w-full max-w-none border border-input bg-surface-modal px-3 text-sm font-normal text-foreground sm:max-w-none" /></div>
                  {agent.inheritedModel && !modelChanged && <p data-testid="agent-model-legacy-hint" className="text-sm leading-relaxed text-muted-foreground">{t('profile.legacyModelHint')}</p>}
                  {!modelOptions.length && <p className="text-sm text-muted-foreground">{t('settingsDialog.modelProviderEmpty')}</p>}
                </div>
              </section>
              <section className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:gap-3">
                <h3 className="text-sm font-medium text-foreground sm:pt-2">{t('fallbacks.title')}</h3>
                <div className="min-w-0 space-y-2"><p className="text-sm text-muted-foreground">{t('fallbacks.agentDescription')}</p>
                  {fallbackDraft === undefined && agent.modelFallbacks == null && <p className="text-sm text-muted-foreground">{t(inheritedFallbacks ? 'fallbacks.inherited' : originallyInherited && modelChanged && defaultModelFallbacks.length > 0 ? 'fallbacks.copied' : 'fallbacks.strict')}</p>}
                  <ModelFallbackEditor value={fallbackValue} onChange={setFallbackDraft} options={modelOptions} primary={selectedModel} disabled={busy} prefix="agent" />
                  {inheritedFallbacks && (agent.modelFallbacks != null || fallbackDraft !== undefined && fallbackDraft !== null) && <Button variant="ghost" size="sm" onClick={() => setFallbackDraft(null)}>{t('fallbacks.inherited')}</Button>}
                </div>
              </section>
              <section className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:gap-3">
                <h3 className="text-sm font-medium text-foreground sm:pt-2">{t('detailTabs.directory')}</h3>
                <div className="flex min-h-9 min-w-0 items-center gap-3"><span className="min-w-0 flex-1 truncate text-sm text-foreground" title={agent.workspace}>{agent.workspace}</span><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('profile.openFolder')} onClick={() => void openWorkspace()}><FolderOpen className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('profile.openFolder')}</TooltipContent></Tooltip></div>
              </section>
              <section className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:gap-3">
                <h3 className="text-sm font-medium text-foreground sm:pt-2">{t('profile.channelsTitle')}</h3>
                <div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1 space-y-2 py-2">{boundAccounts.length ? boundAccounts.map(account => <div key={`${account.channelType}-${account.accountId}`} className="flex min-w-0 items-center gap-2 text-sm"><ChannelLogo type={account.channelType} className="h-4 w-4" /><span className="min-w-0 truncate" title={`${account.channelName} · ${account.name || account.accountId}`}>{account.channelName} · {account.name || account.accountId}</span></div>) : <p className="text-sm text-muted-foreground">{t('detailTabs.noBindings')}</p>}</div><Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-2 text-primary" onClick={() => requestClose(() => navigate('/channels'))}>{t('profile.manageChannels')}<ArrowUpRight className="h-3.5 w-3.5" /></Button></div>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="profile" forceMount className="m-0 data-[state=inactive]:hidden">
            <section className="space-y-2.5" aria-labelledby="agent-files-title">
              <div className="flex items-center justify-between gap-3"><h3 id="agent-files-title" className="text-base font-medium">{t('profile.filesTitle')}</h3><Button variant="ghost" className="h-8 gap-1 px-2 text-sm text-muted-foreground" onClick={onWorkspaceSaved} aria-label={t('profile.refreshFiles')} title={t('profile.refreshFiles')}>{t('refresh')}</Button></div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {soulFile && <div className="flex min-w-0 items-center">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5" aria-label={t('profile.viewFile', { file: 'SOUL.md' })} onClick={event => openFile(soulFile, event.currentTarget)}><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block text-sm font-medium">{t('profile.workStyle')}</span><span className="block truncate font-mono text-meta text-muted-foreground">SOUL.md</span></span><ArrowUpRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" /></button>
                  {!workspace?.readOnly && !editingStyle && <Button variant="ghost" className="h-8 shrink-0 gap-1 px-2 text-sm" onClick={() => { styleBaseRef.current = workspace?.instructions ?? ''; setStyleDraft(styleBaseRef.current); setStyleConflict(false); setEditingStyle(true); }}><Pencil className="h-3 w-3" />{t('profile.editStyle')}</Button>}
                </div>}
                {remainingFiles.map(target => <button key={target.filePath} type="button" className="flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5" aria-label={t('profile.viewFile', { file: target.fileName })} onClick={event => openFile(target, event.currentTarget)}><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block text-sm font-medium">{t(`profile.files.${fileLabels[target.fileName] || 'note'}`)}</span><span className="block truncate font-mono text-meta text-muted-foreground">{target.fileName}</span></span><ArrowUpRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" /></button>)}
              </div>
              {editingStyle && <div className="space-y-2"><Label htmlFor="agent-style-editor" className="text-sm font-medium">{t('profile.workStyle')} · SOUL.md</Label><Textarea id="agent-style-editor" data-testid="agent-style-editor" value={styleDraft} onChange={event => setStyleDraft(event.target.value)} rows={7} className="text-sm leading-relaxed" disabled={savingStyle} />{styleConflict && <div role="alert" className="space-y-1 text-sm text-amber-700 dark:text-amber-400"><p>{t('profile.fileChanged')}</p><Button variant="outline" className="h-8 text-sm" onClick={() => { styleBaseRef.current = latestStyleRef.current; setStyleDraft(latestStyleRef.current); setStyleConflict(false); }}>{t('profile.reloadStyle')}</Button></div>}<div className="flex justify-end gap-2"><Button variant="ghost" className="h-8 text-sm" onClick={() => setEditingStyle(false)} disabled={savingStyle}>{t('common:actions.cancel')}</Button><Button className="h-8 text-sm" onClick={() => void saveStyle()} disabled={busy || !styleChanged}>{savingStyle && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}{t('profile.saveStyle')}</Button></div></div>}
              {!soulFile && <p className="text-sm text-muted-foreground">{workspace === undefined ? t('profile.loadingFiles') : workspace.error ? t('profile.filesUnavailable') : t('profile.noStyle')}</p>}
              {workspace?.readOnly && soulFile && <p className="text-sm text-muted-foreground">{t('profile.readOnlyStyle')}</p>}
              {!hasMemory && workspace && !workspace.error && <p className="text-sm leading-relaxed text-muted-foreground">{t('profile.memoryHint')}</p>}
            </section>
          </TabsContent>
        </div>
      </Tabs>
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => requestClose()}>{t(tab === 'overview' ? 'common:actions.cancel' : 'common:actions.close')}</Button>
        {tab === 'overview' && <Button size="sm" data-testid="agent-overview-save" disabled={busy || !name.trim() || (!nameChanged && !modelChanged && !fallbackChanged)} onClick={() => void saveOverview()}>{savingOverview && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('common:actions.save')}</Button>}
      </footer>
    </DialogContent>
    <ConfirmDialog open={confirmClose} title={t('settingsDialog.unsavedChangesTitle')} message={t('settingsDialog.unsavedChangesMessage')} confirmLabel={t('settingsDialog.closeWithoutSaving')} cancelLabel={t('common:actions.cancel')} onCancel={() => { setConfirmClose(false); pendingNavigation.current = undefined; }} onConfirm={() => { setConfirmClose(false); setName(agent.name); setModelDraft(null); setFallbackDraft(undefined); setEditingStyle(false); finishClose(pendingNavigation.current); }} />
  </Dialog>;
}
