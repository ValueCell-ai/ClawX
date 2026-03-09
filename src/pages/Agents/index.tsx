import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const {
    agents,
    loading,
    error,
    fetchAgents,
    createAgent,
    deleteAgent,
  } = useAgentsStore();
  const { channels, fetchChannels } = useChannelsStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  useEffect(() => {
    void Promise.all([fetchAgents(), fetchChannels()]);
  }, [fetchAgents, fetchChannels]);
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );

  if (loading) {
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([fetchAgents(), fetchChannels()]);
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('refresh')}
          </Button>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('addAgent')}
          </Button>
        </div>
      </div>

      {gatewayStatus.state !== 'running' && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            <span className="text-yellow-700 dark:text-yellow-400">
              {t('gatewayWarning')}
            </span>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onOpenSettings={() => setActiveAgentId(agent.id)}
            onDelete={() => setAgentToDelete(agent)}
          />
        ))}
      </div>

      {showAddDialog && (
        <AddAgentDialog
          onClose={() => setShowAddDialog(false)}
          onCreate={async (name) => {
            await createAgent(name);
            setShowAddDialog(false);
            toast.success(t('toast.agentCreated'));
          }}
        />
      )}

      {activeAgent && (
        <AgentSettingsModal
          agent={activeAgent}
          channels={channels}
          onClose={() => setActiveAgentId(null)}
        />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          await deleteAgent(agentToDelete.id);
          setAgentToDelete(null);
          if (activeAgentId === agentToDelete.id) {
            setActiveAgentId(null);
          }
          toast.success(t('toast.agentDeleted'));
        }}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}

function AgentCard({
  agent,
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const channelsText = agent.channelTypes.length > 0
    ? agent.channelTypes.map((channelType) => CHANNEL_NAMES[channelType as ChannelType] || channelType).join(', ')
    : t('none');

  return (
    <Card className={agent.isDefault ? 'ring-2 ring-primary/30' : undefined}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-full bg-primary/10 p-3">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold truncate">{agent.name}</h2>
                {agent.isDefault && (
                  <Badge variant="secondary">{t('defaultBadge')}</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('modelLine', {
                  model: agent.modelDisplay,
                  suffix: agent.inheritedModel ? ` (${t('inherited')})` : '',
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('channelsLine', { channels: channelsText })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!agent.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
                title={t('deleteAgent')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onOpenSettings} title={t('settings')}>
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AddAgentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim());
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('createDialog.title')}</CardTitle>
          <CardDescription>{t('createDialog.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name">{t('createDialog.nameLabel')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving || !name.trim()}>
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentSettingsModal({
  agent,
  channels,
  onClose,
}: {
  agent: AgentSummary;
  channels: Array<{ type: string; name: string; status: 'connected' | 'connecting' | 'disconnected' | 'error'; error?: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const { updateAgent, assignChannel, removeChannel } = useAgentsStore();
  const { fetchChannels } = useChannelsStore();
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [channelToRemove, setChannelToRemove] = useState<ChannelType | null>(null);

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  const runtimeChannelsByType = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.type, channel])),
    [channels],
  );

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === agent.name) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleChannelSaved = async (channelType: ChannelType) => {
    try {
      await assignChannel(agent.id, channelType);
      await fetchChannels();
      toast.success(t('toast.channelAssigned', { channel: CHANNEL_NAMES[channelType] || channelType }));
    } catch (error) {
      toast.error(t('toast.channelAssignFailed', { error: String(error) }));
      throw error;
    }
  };

  const assignedChannels = agent.channelTypes.map((channelType) => {
    const runtimeChannel = runtimeChannelsByType[channelType];
    return {
      channelType: channelType as ChannelType,
      name: runtimeChannel?.name || CHANNEL_NAMES[channelType as ChannelType] || channelType,
      status: runtimeChannel?.status || 'disconnected',
      error: runtimeChannel?.error,
    };
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>{t('settingsDialog.title', { name: agent.name })}</CardTitle>
            <CardDescription>{t('settingsDialog.description')}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-settings-name">{t('settingsDialog.nameLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={agent.isDefault}
                />
                {!agent.isDefault && (
                  <Button
                    variant="outline"
                    onClick={() => void handleSaveName()}
                    disabled={savingName || !name.trim() || name.trim() === agent.name}
                  >
                    {savingName ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      t('common:actions.save')
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">{t('settingsDialog.agentIdLabel')}</p>
                <p className="font-mono text-sm">{agent.id}</p>
              </div>
              <div className="space-y-1 rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">{t('settingsDialog.modelLabel')}</p>
                <p className="text-sm">
                  {agent.modelDisplay}
                  {agent.inheritedModel ? ` (${t('inherited')})` : ''}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium">{t('settingsDialog.channelsTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('settingsDialog.channelsDescription')}</p>
              </div>
              <Button onClick={() => setShowChannelModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t('settingsDialog.addChannel')}
              </Button>
            </div>

            {assignedChannels.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {t('settingsDialog.noChannels')}
              </div>
            ) : (
              <div className="space-y-3">
                {assignedChannels.map((channel) => (
                  <div key={channel.channelType} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl">{CHANNEL_ICONS[channel.channelType]}</span>
                      <div className="min-w-0">
                        <p className="font-medium">{channel.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {CHANNEL_NAMES[channel.channelType]}
                        </p>
                        {channel.error && (
                          <p className="text-xs text-destructive mt-1">{channel.error}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={channel.status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setChannelToRemove(channel.channelType)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {showChannelModal && (
        <ChannelConfigModal
          configuredTypes={agent.channelTypes}
          showChannelName={false}
          allowExistingConfig
          onClose={() => setShowChannelModal(false)}
          onChannelSaved={async (channelType) => {
            await handleChannelSaved(channelType);
            setShowChannelModal(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!channelToRemove}
        title={t('removeChannelDialog.title')}
        message={channelToRemove ? t('removeChannelDialog.message', { name: CHANNEL_NAMES[channelToRemove] || channelToRemove }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!channelToRemove) return;
          try {
            await removeChannel(agent.id, channelToRemove);
            await fetchChannels();
            toast.success(t('toast.channelRemoved', { channel: CHANNEL_NAMES[channelToRemove] || channelToRemove }));
          } catch (error) {
            toast.error(t('toast.channelRemoveFailed', { error: String(error) }));
          } finally {
            setChannelToRemove(null);
          }
        }}
        onCancel={() => setChannelToRemove(null)}
      />
    </div>
  );
}

export default Agents;
