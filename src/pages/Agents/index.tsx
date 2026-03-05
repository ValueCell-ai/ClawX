import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';

function normalizeAgentId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'agent';
}

export function Agents() {
  const { t } = useTranslation('agents');
  const { agents, defaultId, mainKey, scope, loading, creating, error, fetchAgents, createAgent } = useAgentsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const [agentName, setAgentName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [workspaceTouched, setWorkspaceTouched] = useState(false);
  const [configDir, setConfigDir] = useState('~/.openclaw');

  useEffect(() => {
    window.electron.ipcRenderer.invoke('openclaw:getConfigDir')
      .then((dir) => setConfigDir(String(dir)))
      .catch(() => setConfigDir('~/.openclaw'));
  }, []);

  useEffect(() => {
    if (isGatewayRunning) {
      fetchAgents();
    }
  }, [isGatewayRunning, fetchAgents]);

  const suggestedWorkspace = useMemo(() => {
    const normalizedId = normalizeAgentId(agentName || 'agent');
    return `${configDir}/workspace-${normalizedId}`;
  }, [agentName, configDir]);

  const workspaceValue = workspaceTouched ? workspace : suggestedWorkspace;

  const sortedAgents = useMemo(() => {
    return [...agents].sort((firstAgent, secondAgent) => {
      if (firstAgent.id === defaultId && secondAgent.id !== defaultId) return -1;
      if (firstAgent.id !== defaultId && secondAgent.id === defaultId) return 1;
      return firstAgent.id.localeCompare(secondAgent.id);
    });
  }, [agents, defaultId]);

  const handleCreateAgent = useCallback(async () => {
    const name = agentName.trim();
    const workspaceDir = workspaceValue.trim();

    if (!name || !workspaceDir) {
      return;
    }

    try {
      await createAgent({
        name,
        workspace: workspaceDir,
      });
      toast.success(t('toast.created', { id: normalizeAgentId(name) }));
      setAgentName('');
      setWorkspace('');
      setWorkspaceTouched(false);
    } catch (createError) {
      toast.error(`${t('toast.createFailed')}: ${String(createError)}`);
    }
  }, [agentName, workspaceValue, createAgent, t]);

  if (loading && agents.length === 0) {
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
        <Button variant="outline" onClick={fetchAgents} disabled={!isGatewayRunning || loading}>
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
            <Plus className="h-5 w-5" />
            {t('create.title')}
          </CardTitle>
          <CardDescription>{t('create.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('create.nameLabel')}</label>
            <Input
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder={t('create.namePlaceholder')}
              disabled={!isGatewayRunning || creating}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('create.workspaceLabel')}</label>
            <Input
              value={workspaceValue}
              onChange={(event) => {
                setWorkspace(event.target.value);
                setWorkspaceTouched(true);
              }}
              placeholder={t('create.workspacePlaceholder')}
              disabled={!isGatewayRunning || creating}
            />
          </div>
          <Button
            onClick={handleCreateAgent}
            disabled={!isGatewayRunning || creating || !agentName.trim() || !workspaceValue.trim()}
          >
            <Bot className="h-4 w-4 mr-2" />
            {creating ? t('create.creating') : t('create.submit')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
          <CardDescription>{t('list.description', { count: sortedAgents.length, scope })}</CardDescription>
        </CardHeader>
        <CardContent>
          {sortedAgents.length === 0 ? (
            <p className="text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <div className="space-y-3">
              {sortedAgents.map((agent) => {
                const displayName = agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
                const hasIdentity = Boolean(agent.identity?.emoji || agent.identity?.name);

                return (
                  <div
                    key={agent.id}
                    className="rounded-lg border p-4 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{displayName}</p>
                      <p className="text-sm text-muted-foreground truncate">{agent.id}</p>
                      {hasIdentity && (
                        <p className="text-sm text-muted-foreground mt-1 truncate">
                          <Sparkles className="inline h-3 w-3 mr-1" />
                          {[agent.identity?.emoji, agent.identity?.name].filter(Boolean).join(' ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {agent.id === defaultId && <Badge>{t('list.defaultBadge')}</Badge>}
                      {agent.id === mainKey && (
                        <Badge variant="outline">{t('list.mainBadge')}</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Agents;
