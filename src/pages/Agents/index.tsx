import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import type { AgentRow } from '@/types/agent';

function normalizeAgentId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'agent';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertIdentityField(content: string, field: string, value: string): string {
  const normalizedValue = value.trim();
  const pattern = new RegExp(`^\\s*-\\s*${escapeRegExp(field)}\\s*:.*$`, 'i');
  const existingLines = content.split(/\r?\n/);

  const nextLines = existingLines.filter((line) => !pattern.test(line));
  if (normalizedValue) {
    nextLines.push(`- ${field}: ${normalizedValue}`);
  }

  const normalizedContent = nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return normalizedContent ? `${normalizedContent}\n` : '';
}

function formatSize(size?: number): string {
  if (typeof size !== 'number' || Number.isNaN(size)) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(timestamp?: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const {
    agents,
    defaultId,
    mainKey,
    scope,
    models,
    loading,
    submitting,
    deletingAgentId,
    error,
    fetchAgents,
    fetchModels,
    createAgent,
    updateAgent,
    deleteAgent,
    listAgentFiles,
    getAgentFile,
    setAgentFile,
  } = useAgentsStore();

  const [configDir, setConfigDir] = useState('~/.openclaw');

  const [nameInput, setNameInput] = useState('');
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [workspaceTouched, setWorkspaceTouched] = useState(false);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [modelInput, setModelInput] = useState('');
  const [emojiInput, setEmojiInput] = useState('');
  const [avatarInput, setAvatarInput] = useState('');
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  const [deleteCandidate, setDeleteCandidate] = useState<AgentRow | null>(null);

  const [filesAgentId, setFilesAgentId] = useState('');
  const [filesWorkspace, setFilesWorkspace] = useState('');
  const [files, setFiles] = useState<Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }>>([]);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [fileOriginalContent, setFileOriginalContent] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingFileContent, setLoadingFileContent] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  useEffect(() => {
    window.electron.ipcRenderer.invoke('openclaw:getConfigDir')
      .then((dir) => setConfigDir(String(dir)))
      .catch(() => setConfigDir('~/.openclaw'));
  }, []);

  useEffect(() => {
    if (!isGatewayRunning) return;
    void fetchAgents();
    void fetchModels();
  }, [isGatewayRunning, fetchAgents, fetchModels]);

  const sortedAgents = useMemo(() => {
    return [...agents].sort((firstAgent, secondAgent) => {
      if (firstAgent.id === defaultId && secondAgent.id !== defaultId) return -1;
      if (firstAgent.id !== defaultId && secondAgent.id === defaultId) return 1;
      return firstAgent.id.localeCompare(secondAgent.id);
    });
  }, [agents, defaultId]);

  const suggestedWorkspace = useMemo(() => {
    const normalizedId = normalizeAgentId(nameInput || 'agent');
    return `${configDir}/workspace-${normalizedId}`;
  }, [nameInput, configDir]);

  const workspaceValue = workspaceTouched ? workspaceInput : suggestedWorkspace;

  const currentEditingAgent = useMemo(
    () => sortedAgents.find((agent) => agent.id === editingAgentId) ?? null,
    [sortedAgents, editingAgentId]
  );

  const activeFilesAgentId = filesAgentId || sortedAgents[0]?.id || '';

  const fileDirty = fileContent !== fileOriginalContent;

  const resetForm = useCallback(() => {
    setNameInput('');
    setWorkspaceInput('');
    setWorkspaceTouched(false);
    setWorkspaceLoadFailed(false);
    setModelInput('');
    setEmojiInput('');
    setAvatarInput('');
    setEditingAgentId(null);
  }, []);

  const syncIdentityFields = useCallback(async (
    agentId: string,
    fields: { name?: string; emoji?: string; avatar?: string }
  ) => {
    const identityResult = await getAgentFile(agentId, 'IDENTITY.md');
    const currentContent = identityResult.file.content ?? '';
    let nextContent = currentContent;

    if (typeof fields.name === 'string') {
      nextContent = upsertIdentityField(nextContent, 'Name', fields.name);
    }

    if (typeof fields.emoji === 'string') {
      nextContent = upsertIdentityField(nextContent, 'Emoji', fields.emoji);
    }

    if (typeof fields.avatar === 'string') {
      nextContent = upsertIdentityField(nextContent, 'Avatar', fields.avatar);
    }

    if (nextContent !== currentContent) {
      await setAgentFile(agentId, 'IDENTITY.md', nextContent);
    }
  }, [getAgentFile, setAgentFile]);

  const loadFileContent = useCallback(async (agentId: string, fileName: string) => {
    if (!agentId || !fileName) return;
    setLoadingFileContent(true);
    try {
      const fileResult = await getAgentFile(agentId, fileName);
      const nextContent = fileResult.file.content ?? '';
      setSelectedFileName(fileName);
      setFileContent(nextContent);
      setFileOriginalContent(nextContent);
    } catch (loadError) {
      toast.error(`${t('toast.fileLoadFailed')}: ${String(loadError)}`);
    } finally {
      setLoadingFileContent(false);
    }
  }, [getAgentFile, t]);

  const refreshAgentFiles = useCallback(async (agentId: string, preferredFileName?: string) => {
    if (!agentId) return;
    setLoadingFiles(true);
    try {
      const result = await listAgentFiles(agentId);
      setFilesWorkspace(result.workspace);
      setFiles(result.files ?? []);

      const nextFileName = preferredFileName
        || selectedFileName
        || result.files?.[0]?.name
        || '';

      if (nextFileName) {
        await loadFileContent(agentId, nextFileName);
      } else {
        setSelectedFileName('');
        setFileContent('');
        setFileOriginalContent('');
      }
    } catch (loadError) {
      toast.error(`${t('toast.fileLoadFailed')}: ${String(loadError)}`);
    } finally {
      setLoadingFiles(false);
    }
  }, [listAgentFiles, loadFileContent, selectedFileName, t]);

  const handleCreateAgent = useCallback(async () => {
    const nextName = nameInput.trim();
    const nextWorkspace = workspaceValue.trim();
    const nextModel = modelInput.trim();
    const nextEmoji = emojiInput.trim();
    const nextAvatar = avatarInput.trim();

    if (!nextName || !nextWorkspace) return;

    const createResult = await createAgent({
      name: nextName,
      workspace: nextWorkspace,
      ...(nextEmoji ? { emoji: nextEmoji } : {}),
      ...(nextAvatar ? { avatar: nextAvatar } : {}),
    }).catch((createError) => {
      toast.error(`${t('toast.createFailed')}: ${String(createError)}`);
      return null;
    });

    if (!createResult) return;

    const nextAgentId = createResult.agentId;

    const postCreateErrors: string[] = [];

    if (nextModel) {
      try {
        await updateAgent({
          agentId: nextAgentId,
          model: nextModel,
        });
      } catch (updateModelError) {
        postCreateErrors.push(`${t('toast.modelUpdateFailed')}: ${String(updateModelError)}`);
      }
    }

    try {
      await syncIdentityFields(nextAgentId, {
        name: nextName,
        emoji: nextEmoji,
        avatar: nextAvatar,
      });
    } catch (syncError) {
      postCreateErrors.push(`${t('toast.identitySyncFailed')}: ${String(syncError)}`);
    }

    if (postCreateErrors.length > 0) {
      toast.warning(t('toast.createdWithWarnings', { id: nextAgentId }));
      postCreateErrors.forEach((message) => {
        toast.error(message);
      });
    } else {
      toast.success(t('toast.created', { id: nextAgentId }));
    }

    resetForm();
    setFilesAgentId(nextAgentId);
    await refreshAgentFiles(nextAgentId);
  }, [
    nameInput,
    workspaceValue,
    modelInput,
    emojiInput,
    avatarInput,
    createAgent,
    updateAgent,
    syncIdentityFields,
    resetForm,
    refreshAgentFiles,
    t,
  ]);

  const handleStartEdit = useCallback(async (agent: AgentRow) => {
    setEditingAgentId(agent.id);
    setNameInput(agent.name?.trim() || agent.id);
    setModelInput('');
    setEmojiInput(agent.identity?.emoji ?? '');
    setAvatarInput(agent.identity?.avatar ?? '');
    setWorkspaceLoadFailed(false);

    try {
      const fileResult = await listAgentFiles(agent.id);
      setWorkspaceInput(fileResult.workspace);
      setWorkspaceTouched(true);
      setWorkspaceLoadFailed(false);
    } catch {
      setWorkspaceInput('');
      setWorkspaceTouched(true);
      setWorkspaceLoadFailed(true);
      toast.error(t('toast.workspaceLoadFailed'));
    }
  }, [listAgentFiles, t]);

  const handleUpdateAgent = useCallback(async () => {
    if (!editingAgentId) return;
    if (workspaceLoadFailed) {
      toast.error(t('form.workspaceLoadError'));
      return;
    }

    const nextName = nameInput.trim();
    const nextWorkspace = workspaceValue.trim();
    const nextModel = modelInput.trim();
    const nextEmoji = emojiInput.trim();
    const nextAvatar = avatarInput.trim();

    if (!nextName || !nextWorkspace) return;

    try {
      await updateAgent({
        agentId: editingAgentId,
        name: nextName,
        workspace: nextWorkspace,
        ...(nextModel ? { model: nextModel } : {}),
      });

      await syncIdentityFields(editingAgentId, {
        name: nextName,
        emoji: nextEmoji,
        avatar: nextAvatar,
      });

      toast.success(t('toast.updated', { id: editingAgentId }));
      resetForm();

      if (activeFilesAgentId === editingAgentId) {
        await refreshAgentFiles(editingAgentId);
      }
    } catch (updateError) {
      toast.error(`${t('toast.updateFailed')}: ${String(updateError)}`);
    }
  }, [
    editingAgentId,
    nameInput,
    workspaceValue,
    modelInput,
    emojiInput,
    avatarInput,
    workspaceLoadFailed,
    updateAgent,
    syncIdentityFields,
    resetForm,
    activeFilesAgentId,
    refreshAgentFiles,
    t,
  ]);

  const handleDeleteAgent = useCallback(async () => {
    if (!deleteCandidate) return;
    try {
      await deleteAgent({ agentId: deleteCandidate.id, deleteFiles: true });
      toast.success(t('toast.deleted', { id: deleteCandidate.id }));

      if (editingAgentId === deleteCandidate.id) {
        resetForm();
      }

      if (activeFilesAgentId === deleteCandidate.id) {
        setFilesAgentId('');
        setFilesWorkspace('');
        setFiles([]);
        setSelectedFileName('');
        setFileContent('');
        setFileOriginalContent('');
      }
      setDeleteCandidate(null);
    } catch (deleteError) {
      toast.error(`${t('toast.deleteFailed')}: ${String(deleteError)}`);
    }
  }, [deleteCandidate, deleteAgent, editingAgentId, resetForm, activeFilesAgentId, t]);

  const handleSaveFile = useCallback(async () => {
    if (!activeFilesAgentId || !selectedFileName) return;
    setSavingFile(true);
    try {
      await setAgentFile(activeFilesAgentId, selectedFileName, fileContent);
      setFileOriginalContent(fileContent);
      await refreshAgentFiles(activeFilesAgentId, selectedFileName);
      toast.success(t('toast.fileSaved', { file: selectedFileName }));
    } catch (saveError) {
      toast.error(`${t('toast.fileSaveFailed')}: ${String(saveError)}`);
    } finally {
      setSavingFile(false);
    }
  }, [activeFilesAgentId, selectedFileName, fileContent, setAgentFile, refreshAgentFiles, t]);

  const handleOpenWorkspace = useCallback(async () => {
    if (!filesWorkspace) return;
    try {
      const result = await window.electron.ipcRenderer.invoke('shell:openPath', filesWorkspace) as string;
      if (result) {
        throw new Error(result);
      }
    } catch (openError) {
      toast.error(`${t('toast.workspaceOpenFailed')}: ${String(openError)}`);
    }
  }, [filesWorkspace, t]);

  if (loading && sortedAgents.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            await fetchAgents();
            await fetchModels();
          }}
          disabled={!isGatewayRunning || loading}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('refresh')}
        </Button>
      </div>

      {!isGatewayRunning && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
          <CardContent className="py-4">
            <p className="text-yellow-700 dark:text-yellow-400">{t('gatewayWarning')}</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-900/10">
          <CardContent className="py-4">
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {editingAgentId ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            {editingAgentId ? t('form.editTitle') : t('form.createTitle')}
          </CardTitle>
          <CardDescription>
            {editingAgentId ? t('form.editDescription') : t('form.createDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('form.nameLabel')}</label>
            <Input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder={t('form.namePlaceholder')}
              disabled={!isGatewayRunning || submitting}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('form.workspaceLabel')}</label>
            <Input
              value={workspaceValue}
              onChange={(event) => {
                setWorkspaceInput(event.target.value);
                setWorkspaceTouched(true);
                setWorkspaceLoadFailed(false);
              }}
              placeholder={t('form.workspacePlaceholder')}
              disabled={!isGatewayRunning || submitting}
            />
            {editingAgentId && workspaceLoadFailed && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('form.workspaceLoadError')}
              </p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('form.modelLabel')}</label>
              <Input
                list="agent-model-options"
                value={modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                placeholder={t('form.modelPlaceholder')}
                disabled={!isGatewayRunning || submitting}
              />
              <datalist id="agent-model-options">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {`${model.provider} · ${model.name}`}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('form.emojiLabel')}</label>
              <Input
                value={emojiInput}
                onChange={(event) => setEmojiInput(event.target.value)}
                placeholder={t('form.emojiPlaceholder')}
                disabled={!isGatewayRunning || submitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('form.avatarLabel')}</label>
            <Input
              value={avatarInput}
              onChange={(event) => setAvatarInput(event.target.value)}
              placeholder={t('form.avatarPlaceholder')}
              disabled={!isGatewayRunning || submitting}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={editingAgentId ? handleUpdateAgent : handleCreateAgent}
              disabled={
                !isGatewayRunning
                || submitting
                || !nameInput.trim()
                || !workspaceValue.trim()
                || (Boolean(editingAgentId) && workspaceLoadFailed)
              }
            >
              <Bot className="h-4 w-4 mr-2" />
              {submitting
                ? t('form.submitting')
                : editingAgentId
                  ? t('form.saveButton')
                  : t('form.createButton')}
            </Button>

            {editingAgentId && (
              <Button
                variant="outline"
                onClick={resetForm}
                disabled={submitting}
              >
                {t('form.cancelEdit')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
          <CardDescription>
            {t('list.description', { count: sortedAgents.length, scope })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedAgents.length === 0 ? (
            <p className="text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <div className="space-y-3">
              {sortedAgents.map((agent) => {
                const displayName = agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
                const isDeleting = deletingAgentId === agent.id;

                return (
                  <div
                    key={agent.id}
                    className="rounded-lg border p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{displayName}</p>
                      <p className="text-sm text-muted-foreground truncate">{agent.id}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {[agent.identity?.emoji, agent.identity?.avatar].filter(Boolean).join(' · ') || '-'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {agent.id === defaultId && <Badge>{t('list.defaultBadge')}</Badge>}
                      {agent.id === mainKey && (
                        <Badge variant="outline">{t('list.mainBadge')}</Badge>
                      )}
                      <Button size="sm" variant="outline" onClick={() => void handleStartEdit(agent)}>
                        <Pencil className="h-4 w-4 mr-1" />
                        {t('list.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          setFilesAgentId(agent.id);
                          await refreshAgentFiles(agent.id);
                        }}
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        {t('list.configureFiles')}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteCandidate(agent)}
                        disabled={agent.id === defaultId || isDeleting}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        {isDeleting ? t('list.deleting') : t('list.delete')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('files.title')}</CardTitle>
          <CardDescription>{t('files.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedAgents.length === 0 ? (
            <p className="text-muted-foreground">{t('files.noAgent')}</p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('files.agentLabel')}</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={activeFilesAgentId}
                    onChange={(event) => {
                      const nextAgentId = event.target.value;
                      setFilesAgentId(nextAgentId);
                      void refreshAgentFiles(nextAgentId);
                    }}
                  >
                    {sortedAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name?.trim() || agent.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('files.workspaceLabel')}</label>
                  <div className="flex items-center gap-2">
                    <Input value={filesWorkspace} readOnly />
                    <Button variant="outline" onClick={handleOpenWorkspace} disabled={!filesWorkspace}>
                      <FolderOpen className="h-4 w-4 mr-2" />
                      {t('files.openWorkspace')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void refreshAgentFiles(activeFilesAgentId)}
                      disabled={!activeFilesAgentId || loadingFiles}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('files.reload')}
                    </Button>
                  </div>
                </div>
              </div>

              {loadingFiles ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoadingSpinner size="sm" />
                  <span>{t('files.loading')}</span>
                </div>
              ) : (
                <>
                  <div className="grid gap-2">
                    {files.map((file) => (
                      <button
                        key={file.name}
                        onClick={() => void loadFileContent(activeFilesAgentId, file.name)}
                        className={`text-left rounded-md border px-3 py-2 transition-colors ${
                          selectedFileName === file.name
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-accent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{file.name}</span>
                            {file.missing && <Badge variant="outline">{t('files.missingBadge')}</Badge>}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatSize(file.size)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatUpdatedAt(file.updatedAtMs)}
                        </p>
                      </button>
                    ))}
                  </div>

                  {selectedFileName && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        {t('files.editorLabel', { file: selectedFileName })}
                      </label>
                      {loadingFileContent ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <LoadingSpinner size="sm" />
                          <span>{t('files.loading')}</span>
                        </div>
                      ) : (
                        <Textarea
                          value={fileContent}
                          onChange={(event) => setFileContent(event.target.value)}
                          rows={16}
                          className="font-mono text-xs"
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={handleSaveFile}
                          disabled={!selectedFileName || savingFile || !fileDirty}
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {savingFile ? t('files.saving') : t('files.save')}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {fileDirty ? t('files.unsavedHint') : t('files.savedHint')}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteCandidate}
        title={t('confirmDelete.title')}
        message={deleteCandidate ? t('confirmDelete.message', { id: deleteCandidate.id }) : ''}
        confirmLabel={t('confirmDelete.confirm')}
        cancelLabel={t('confirmDelete.cancel')}
        variant="destructive"
        onConfirm={() => void handleDeleteAgent()}
        onCancel={() => setDeleteCandidate(null)}
      />

      {currentEditingAgent && (
        <p className="text-xs text-muted-foreground">
          {t('form.editingHint', { id: currentEditingAgent.id })}
        </p>
      )}
    </div>
  );
}

export default Agents;
