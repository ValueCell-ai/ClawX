import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Bot, FileText, FolderOpen, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectGroup, SelectItem, SelectLabel } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ModelIcon } from '@/components/common/ModelIcon';
import type { FilePreviewTarget } from '@/components/file-preview/types';
import { hostApi, type ChannelGroupItem } from '@/lib/host-api';
import { readTextFile, writeTextFile } from '@/lib/file-preview-client';
import { agentInstructionsSummary, type AgentWorkspaceSnapshot } from '@/lib/agent-workspace';
import { buildConfiguredModelOptions, formatModelRefLabel, splitModelRef } from '@/lib/model-options';
import { useAgentsStore } from '@/stores/agents';
import { useProviderStore } from '@/stores/providers';
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
  const { updateAgent, updateAgentModel, defaultModelRef } = useAgentsStore();
  const accounts = useProviderStore(state => state.accounts);
  const statuses = useProviderStore(state => state.statuses);
  const vendors = useProviderStore(state => state.vendors);
  const defaultAccountId = useProviderStore(state => state.defaultAccountId);
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [editingStyle, setEditingStyle] = useState(false);
  const [styleDraft, setStyleDraft] = useState('');
  const styleBaseRef = useRef('');
  const latestStyleRef = useRef('');
  const [styleConflict, setStyleConflict] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [customModel, setCustomModel] = useState(agent.overrideModelRef || '');
  const [confirmClose, setConfirmClose] = useState(false);
  const pendingNavigation = useRef<(() => void) | undefined>(undefined);
  const [file, setFile] = useState<FilePreviewTarget | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const fileTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { setName(agent.name); }, [agent.name]);
  useEffect(() => { setCustomModel(agent.overrideModelRef || ''); }, [agent.overrideModelRef]);
  const modelOptions = useMemo(() => buildConfiguredModelOptions(accounts, statuses, vendors, defaultAccountId), [accounts, statuses, vendors, defaultAccountId]);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, { name: string; options: typeof modelOptions }>();
    for (const option of modelOptions) {
      const group = groups.get(option.runtimeProviderKey);
      if (group) group.options.push(option);
      else groups.set(option.runtimeProviderKey, { name: option.providerName, options: [option] });
    }
    return [...groups.entries()];
  }, [modelOptions]);
  const override = agent.overrideModelRef || '';
  const customChanged = customModel.trim() !== override;
  const nameChanged = name.trim() !== agent.name;
  const styleChanged = editingStyle && styleDraft !== styleBaseRef.current;
  const busy = savingName || savingStyle || savingModel;
  const finishClose = (action?: () => void) => { onClose(); action?.(); };
  const requestClose = (action?: () => void) => {
    if (busy) return;
    pendingNavigation.current = action;
    if (nameChanged || styleChanged || customChanged) setConfirmClose(true);
    else finishClose(action);
  };
  const openFile = (target: FilePreviewTarget, trigger: HTMLButtonElement) => { fileTriggerRef.current = trigger; setFile(target); setReaderOpen(true); };
  const soulFile = workspace?.files.find(file => file.fileName === 'SOUL.md');
  const remainingFiles = workspace?.files.filter(file => file.fileName !== 'SOUL.md') ?? [];
  const hasMemory = remainingFiles.some(file => file.fileName === 'MEMORY.md' || /\d{4}-\d{2}-\d{2}/.test(file.fileName));
  const boundAccounts = channelGroups.flatMap(group => group.accounts.filter(account => account.agentId === agent.id).map(account => ({ ...account, channelName: CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType })));
  const saveName = async () => {
    if (!name.trim() || !nameChanged || busy) return;
    setSavingName(true);
    try { await updateAgent(agent.id, name.trim()); toast.success(t('toast.agentUpdated')); }
    catch (error) { toast.error(t('toast.agentUpdateFailed', { error: String(error) })); }
    finally { setSavingName(false); }
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
  const setModel = async (modelRef: string) => {
    if (busy || modelRef === override) return;
    if (modelRef && !splitModelRef(modelRef)) { toast.error(t('toast.agentModelInvalid')); return; }
    setSavingModel(true);
    try { await updateAgentModel(agent.id, modelRef || null); setCustomModel(modelRef); toast.success(t(modelRef ? 'toast.agentModelUpdated' : 'toast.agentModelReset')); }
    catch (error) { toast.error(t('toast.agentModelUpdateFailed', { error: String(error) })); }
    finally { setSavingModel(false); }
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
      <div className="flex shrink-0 items-center gap-3 px-6 pb-4 pt-6 pr-14"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span><div className="min-w-0"><DialogTitle className="truncate font-sans text-xl font-medium tracking-normal">{t('settingsDialog.title', { name: agent.name })}</DialogTitle><DialogDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settingsDialog.description')}</DialogDescription></div></div>
      <Button variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8" disabled={busy} aria-label={t('profile.close')} title={t('profile.close')} onClick={() => requestClose()}><X className="h-4 w-4" /></Button>
      <Suspense fallback={null}><FileReader file={file} open={open && readerOpen} onClose={() => setReaderOpen(false)} onReturnFocus={() => fileTriggerRef.current?.focus()} testId="agent-file-reader" /></Suspense>
      <div data-testid="agent-detail-content" className="min-h-0 overflow-y-auto px-6 pb-6">
        <div className="space-y-6">
          <div className="space-y-2"><Label htmlFor="agent-settings-name" className="text-sm font-medium">{t('settingsDialog.nameLabel')}</Label><div className="flex gap-2"><Input id="agent-settings-name" value={name} onChange={event => setName(event.target.value)} className="h-9 font-sans" maxLength={120} disabled={savingName} /><Button variant="outline" className="h-9 shrink-0" disabled={busy || !name.trim() || !nameChanged} onClick={() => void saveName()}>{savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('common:actions.save')}</Button></div></div>
          <section className="space-y-2.5" aria-labelledby="agent-work-style-title">
            <div className="flex items-center justify-between gap-3"><h3 id="agent-work-style-title" className="text-sm font-medium">{t('profile.workStyle')}</h3><div className="flex items-center gap-1">{soulFile && !editingStyle && <Button variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" aria-label={t('profile.viewFile', { file: 'SOUL.md' })} onClick={event => openFile(soulFile, event.currentTarget)}><FileText className="h-3.5 w-3.5" />SOUL.md</Button>}{soulFile && !workspace?.readOnly && !editingStyle && <Button variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => { styleBaseRef.current = workspace?.instructions ?? ''; setStyleDraft(styleBaseRef.current); setStyleConflict(false); setEditingStyle(true); }}><Pencil className="h-3 w-3" />{t('profile.editStyle')}</Button>}</div></div>
            {editingStyle ? <div className="space-y-2"><Textarea aria-label={t('profile.workStyle')} data-testid="agent-style-editor" value={styleDraft} onChange={event => setStyleDraft(event.target.value)} rows={7} className="text-sm leading-relaxed" disabled={savingStyle} /><p className="text-xs text-muted-foreground">{t('profile.nativeStyleHint')}</p>{styleConflict && <div role="alert" className="space-y-1 text-xs text-amber-700 dark:text-amber-400"><p>{t('profile.fileChanged')}</p><Button variant="outline" className="h-7 text-xs" onClick={() => { styleBaseRef.current = latestStyleRef.current; setStyleDraft(latestStyleRef.current); setStyleConflict(false); }}>{t('profile.reloadStyle')}</Button></div>}<div className="flex justify-end gap-2"><Button variant="ghost" className="h-8 text-xs" onClick={() => setEditingStyle(false)} disabled={savingStyle}>{t('common:actions.cancel')}</Button><Button className="h-8 text-xs" onClick={() => void saveStyle()} disabled={busy || !styleChanged}>{savingStyle && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}{t('profile.saveStyle')}</Button></div></div> : <><p className="text-sm leading-relaxed text-muted-foreground">{workspace === undefined ? t('profile.loadingFiles') : workspace.error ? t('profile.filesUnavailable') : agentInstructionsSummary(workspace.instructions ?? '') || t('profile.noStyle')}</p>{workspace?.readOnly && soulFile && <p className="text-xs text-muted-foreground">{t('profile.readOnlyStyle')}</p>}</>}
          </section>
          <section className="space-y-2.5" aria-labelledby="agent-files-title"><div className="flex items-center justify-between gap-3"><h3 id="agent-files-title" className="text-sm font-medium">{t('profile.filesTitle')}</h3><Button variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={onWorkspaceSaved} aria-label={t('profile.refreshFiles')} title={t('profile.refreshFiles')}>{t('refresh')}</Button></div><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{remainingFiles.map(target => <button key={target.filePath} type="button" className="flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5" aria-label={t('profile.viewFile', { file: target.fileName })} onClick={event => openFile(target, event.currentTarget)}><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block text-xs font-medium">{t(`profile.files.${fileLabels[target.fileName] || 'note'}`)}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{target.fileName}</span></span><ArrowUpRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" /></button>)}</div>{!hasMemory && workspace && !workspace.error && <p className="text-xs leading-relaxed text-muted-foreground">{t('profile.memoryHint')}</p>}{workspace?.error && <p className="text-xs text-muted-foreground">{t('profile.filesUnavailable')}</p>}</section>
          <section className="space-y-2.5 border-t border-border/70 pt-5" aria-labelledby="agent-model-title"><div className="flex items-center justify-between gap-3"><Label id="agent-model-title" htmlFor="agent-model-choice" className="text-sm font-medium">{t('settingsDialog.modelLabel')}</Label>{savingModel && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}</div><Select id="agent-model-choice" data-testid="agent-model-select" value={override} onValueChange={value => void setModel(value)} disabled={busy} className="h-9 bg-surface-modal"><SelectItem value="">{t('profile.followDefault', { model: defaultModelRef ? formatModelRefLabel(defaultModelRef) : t('profile.notConfigured') })}</SelectItem>{override && !modelOptions.some(option => option.modelRef === override) && <SelectItem value={override}>{t('profile.currentModel', { model: formatModelRefLabel(override) })}</SelectItem>}{modelGroups.map(([key, group]) => <SelectGroup key={key}><SelectLabel className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.name}</SelectLabel>{group.options.map(option => <SelectItem key={option.modelRef} value={option.modelRef}><span className="flex items-center gap-2"><ModelIcon modelName={option.modelId} /><span>{option.modelId}</span></span></SelectItem>)}</SelectGroup>)}</Select><p className="text-xs leading-relaxed text-muted-foreground">{t('profile.modelHint')}</p><details className="group"><summary className="cursor-pointer text-xs text-muted-foreground">{t('profile.customModel')}</summary><div className="mt-2 space-y-2"><Label htmlFor="agent-model-ref" className="text-xs text-muted-foreground">{t('profile.modelRefLabel')}</Label><div className="flex gap-2"><Input id="agent-model-ref" value={customModel} onChange={event => setCustomModel(event.target.value)} placeholder={defaultModelRef || t('settingsDialog.modelOverridePlaceholder')} className="h-9 font-mono text-xs" disabled={busy} /><Button variant="outline" className="h-9 shrink-0 text-xs" disabled={busy || !customChanged || (!!customModel.trim() && !splitModelRef(customModel))} onClick={() => void setModel(customModel.trim())}>{t('common:actions.save')}</Button></div></div></details></section>
          <section className="space-y-2.5"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{t('profile.channelsTitle')}</h3><Button variant="ghost" className="h-7 gap-1 px-2 text-xs text-primary" onClick={() => requestClose(() => navigate('/channels'))}>{t('profile.manageChannels')}<ArrowUpRight className="h-3 w-3" /></Button></div>{boundAccounts.length ? <div className="flex flex-wrap gap-2">{boundAccounts.map(account => <span key={`${account.channelName}-${account.accountId}`} className="rounded-md bg-black/5 px-2 py-1 text-xs text-muted-foreground dark:bg-white/10">{account.channelName} · {account.name || account.accountId}</span>)}</div> : <p className="text-xs leading-relaxed text-muted-foreground">{t('profile.noChannels')}</p>}</section>
          <div className="border-t border-border/70 pt-4"><div className="flex min-w-0 items-center gap-2"><FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">{t('profile.workspaceTitle')}</p><p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={agent.workspace}>{agent.workspace}</p></div><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('profile.openFolder')} title={t('profile.openFolder')} onClick={() => void openWorkspace()}><FolderOpen className="h-4 w-4" /></Button></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('profile.workspaceHint')}</p><p className="mt-2 text-[11px] text-muted-foreground">{t('settingsDialog.agentIdLabel')}: <span className="font-mono">{agent.id}</span></p></div>
        </div>
      </div>
    </DialogContent>
    <ConfirmDialog open={confirmClose} title={t('settingsDialog.unsavedChangesTitle')} message={t('settingsDialog.unsavedChangesMessage')} confirmLabel={t('settingsDialog.closeWithoutSaving')} cancelLabel={t('common:actions.cancel')} onCancel={() => { setConfirmClose(false); pendingNavigation.current = undefined; }} onConfirm={() => { setConfirmClose(false); setName(agent.name); setEditingStyle(false); setCustomModel(override); finishClose(pendingNavigation.current); }} />
  </Dialog>;
}
