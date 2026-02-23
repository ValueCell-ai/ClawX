/**
 * Agents Page
 * Manage AI agents - create, edit, delete, toggle
 */
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Plus,
  RefreshCw,
  X,
  Save,
  Trash2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Shield,
  Sparkles,
  Settings,
  Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useSkillsStore } from '@/stores/skills';
import { useProviderStore } from '@/stores/providers';
import { PROVIDER_TYPE_INFO } from '@/lib/providers';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import type { Agent } from '@/types/agent';
import { useTranslation } from 'react-i18next';

// ── Agent Detail/Edit Dialog ──────────────────────────────────────

interface AgentDialogProps {
  agent: Agent | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (agentId: string, updates: Partial<Agent>) => Promise<void>;
  onDelete: (agentId: string) => Promise<void>;
}

function AgentDialog({ agent, isNew, onClose, onSave, onDelete }: AgentDialogProps) {
  const { t } = useTranslation('agents');
  const { skills, fetchSkills } = useSkillsStore();
  const { providers, fetchProviders } = useProviderStore();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Parse existing model into provider + model parts
  // Format: "anthropic/claude-sonnet-4-20250514" => provider="anthropic", modelName="claude-sonnet-4-20250514"
  const parseModel = (model: string) => {
    if (!model) return { providerId: '', modelName: '' };
    const slashIdx = model.indexOf('/');
    if (slashIdx > 0) {
      return { providerId: model.slice(0, slashIdx), modelName: model.slice(slashIdx + 1) };
    }
    return { providerId: '', modelName: model };
  };

  const parsed = parseModel(agent?.model || '');
  const [selectedProviderId, setSelectedProviderId] = useState(parsed.providerId);
  const [modelName, setModelName] = useState(parsed.modelName);

  // Providers with keys (usable for agents)
  const availableProviders = providers.filter(p => p.enabled && (p.hasKey || p.type === 'ollama'));

  const [formData, setFormData] = useState({
    id: agent?.id || '',
    name: agent?.name || '',
    description: agent?.description || '',
    instructions: agent?.instructions || '',
    model: agent?.model || '',
    skills: agent?.skills || [] as string[],
    enabled: agent?.enabled ?? true,
  });

  // Fetch skills and providers on mount
  useEffect(() => {
    fetchSkills();
    fetchProviders();
  }, [fetchSkills, fetchProviders]);

  const handleSave = async () => {
    if (isSaving) return;

    const agentId = isNew ? formData.id.trim().toLowerCase().replace(/\s+/g, '-') : agent!.id;
    if (!agentId) {
      toast.error(t('toast.idRequired'));
      return;
    }
    if (!formData.name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }

    setIsSaving(true);
    try {
      // Compose model string from provider + model name
      const composedModel = selectedProviderId && modelName
        ? `${selectedProviderId}/${modelName}`
        : modelName || '';

      await onSave(agentId, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        instructions: formData.instructions.trim(),
        model: composedModel,
        skills: formData.skills,
        enabled: formData.enabled,
      });
      toast.success(isNew ? t('toast.created') : t('toast.saved'));
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting || !agent || agent.isDefault) return;
    setIsDeleting(true);
    try {
      await onDelete(agent.id);
      toast.success(t('toast.deleted'));
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>{isNew ? t('dialog.createTitle') : formData.name || agent?.name}</CardTitle>
              <CardDescription>
                {isNew ? t('dialog.createSubtitle') : t('dialog.editSubtitle')}
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="general" className="gap-2">
                <Settings className="h-3.5 w-3.5" />
                {t('dialog.general')}
              </TabsTrigger>
              <TabsTrigger value="instructions" className="gap-2">
                <Brain className="h-3.5 w-3.5" />
                {t('dialog.instructions')}
              </TabsTrigger>
              <TabsTrigger value="skills" className="gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                {t('dialog.skills')}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              <TabsContent value="general" className="mt-0 space-y-4">
                {/* Agent ID (only for new agents) */}
                {isNew && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('dialog.agentId')}</label>
                    <Input
                      placeholder="e.g. reddit-crawler"
                      value={formData.id}
                      onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">{t('dialog.agentIdHint')}</p>
                  </div>
                )}

                {/* Name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.name')}</label>
                  <Input
                    placeholder={t('dialog.namePlaceholder')}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.description')}</label>
                  <Input
                    placeholder={t('dialog.descriptionPlaceholder')}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                {/* Provider */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.provider')}</label>
                  <select
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{t('dialog.providerDefault')}</option>
                    {availableProviders.map((p) => {
                      const typeInfo = PROVIDER_TYPE_INFO.find(ti => ti.id === p.type);
                      return (
                        <option key={p.id} value={p.type}>
                          {typeInfo?.icon} {p.name}{p.hasKey ? '' : ` (${t('dialog.noKey')})`}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-xs text-muted-foreground">{t('dialog.providerHint')}</p>
                </div>

                {/* Model */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.model')}</label>
                  <div className="flex items-center gap-2">
                    {selectedProviderId && (
                      <span className="text-sm text-muted-foreground font-mono whitespace-nowrap">
                        {selectedProviderId}/
                      </span>
                    )}
                    <Input
                      placeholder={t('dialog.modelPlaceholder')}
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t('dialog.modelHint')}</p>
                </div>
              </TabsContent>

              <TabsContent value="instructions" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.systemPrompt')}</label>
                  <textarea
                    className="w-full min-h-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                    placeholder={t('dialog.systemPromptPlaceholder')}
                    value={formData.instructions}
                    onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t('dialog.systemPromptHint')}</p>
                </div>
              </TabsContent>

              <TabsContent value="skills" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.assignedSkills')}</label>
                  <p className="text-xs text-muted-foreground">{t('dialog.assignedSkillsHint')}</p>
                  <div className="space-y-1 max-h-[300px] overflow-y-auto rounded-md border p-3">
                    {skills.filter(s => s.enabled).length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">{t('dialog.noSkillsAvailable')}</p>
                    ) : (
                      skills.filter(s => s.enabled).map((skill) => {
                        const isChecked = formData.skills.includes(skill.id);
                        return (
                          <label
                            key={skill.id}
                            className="flex items-center gap-3 rounded-md p-2 hover:bg-accent cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setFormData(prev => ({
                                  ...prev,
                                  skills: isChecked
                                    ? prev.skills.filter(s => s !== skill.id)
                                    : [...prev.skills, skill.id],
                                }));
                              }}
                              className="h-4 w-4 rounded border-input"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">
                                {skill.icon && <span className="mr-1">{skill.icon}</span>}
                                {skill.name}
                              </div>
                              {skill.description && (
                                <div className="text-xs text-muted-foreground truncate">{skill.description}</div>
                              )}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                  {formData.skills.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {formData.skills.length} {t('dialog.skillsSelected')}
                    </p>
                  )}
                </div>
              </TabsContent>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t bg-muted/10">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {formData.enabled ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-600 dark:text-green-400">{t('dialog.enabled')}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{t('dialog.disabled')}</span>
                  </>
                )}
              </div>
              <Switch
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                disabled={agent?.isDefault}
              />
            </div>

            <div className="flex items-center gap-2">
              {agent && !agent.isDefault && !isNew && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={isDeleting || isSaving}
                  className="gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isDeleting ? t('dialog.deleting') : t('dialog.delete')}
                </Button>
              )}
              <Button onClick={handleSave} disabled={isSaving} className="gap-1">
                <Save className="h-3.5 w-3.5" />
                {isSaving ? t('dialog.saving') : t('dialog.save')}
              </Button>
            </div>
          </div>
        </Tabs>
      </Card>
    </div>
  );
}

// ── Agent Card ──────────────────────────────────────────────────

interface AgentCardProps {
  agent: Agent;
  onClick: () => void;
  onToggle: (enabled: boolean) => void;
}

function AgentCard({ agent, onClick, onToggle }: AgentCardProps) {
  const { t } = useTranslation('agents');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      layout
    >
      <Card
        className="hover:border-primary/50 transition-all cursor-pointer group relative"
        onClick={onClick}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                {agent.isDefault ? (
                  <Shield className="h-5 w-5 text-primary" />
                ) : (
                  <Bot className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <CardTitle className="text-base group-hover:text-primary transition-colors flex items-center gap-2">
                  {agent.name}
                  {agent.isDefault && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                      {t('card.default')}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {agent.id}
                </CardDescription>
              </div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={agent.enabled}
                onCheckedChange={(checked) => onToggle(checked)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {agent.description || t('card.noDescription')}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {agent.model && (
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                <span className="truncate max-w-[150px]">{agent.model}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              {agent.enabled ? (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              ) : (
                <XCircle className="h-3 w-3 text-muted-foreground" />
              )}
              <span>{agent.enabled ? t('card.active') : t('card.inactive')}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export function Agents() {
  const { agents, loading, error, fetchAgents, saveAgent, deleteAgent, toggleAgent } = useAgentsStore();
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isNewAgent, setIsNewAgent] = useState(false);
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  const isGatewayRunning = gatewayStatus.state === 'running';

  // Debounce gateway warning
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      timer = setTimeout(() => setShowGatewayWarning(true), 1500);
    } else {
      timer = setTimeout(() => setShowGatewayWarning(false), 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  // Fetch agents on mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleToggle = useCallback(async (agentId: string, enabled: boolean) => {
    try {
      await toggleAgent(agentId, enabled);
      toast.success(enabled ? t('toast.enabled') : t('toast.disabled'));
    } catch (err) {
      toast.error(String(err));
    }
  }, [toggleAgent, t]);

  const handleSave = useCallback(async (agentId: string, updates: Partial<Agent>) => {
    await saveAgent(agentId, updates);
  }, [saveAgent]);

  const handleDelete = useCallback(async (agentId: string) => {
    await deleteAgent(agentId);
  }, [deleteAgent]);

  const handleNewAgent = () => {
    setSelectedAgent(null);
    setIsNewAgent(true);
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchAgents}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('refresh')}
          </Button>
          <Button onClick={handleNewAgent} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('newAgent')}
          </Button>
        </div>
      </div>

      {/* Gateway Warning */}
      {showGatewayWarning && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <span className="text-yellow-700 dark:text-yellow-400">
              {t('gatewayWarning')}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* Agent Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onClick={() => {
                setSelectedAgent(agent);
                setIsNewAgent(false);
              }}
              onToggle={(enabled) => handleToggle(agent.id, enabled)}
            />
          ))}
        </AnimatePresence>

        {/* Empty state placeholder card */}
        {agents.length === 0 && (
          <Card className="border-dashed flex items-center justify-center min-h-[200px] col-span-full">
            <div className="text-center p-8">
              <Bot className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">{t('empty')}</p>
              <Button onClick={handleNewAgent} variant="outline" className="mt-4 gap-2">
                <Plus className="h-4 w-4" />
                {t('newAgent')}
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* Agent Dialog */}
      {(selectedAgent || isNewAgent) && (
        <AgentDialog
          agent={selectedAgent}
          isNew={isNewAgent}
          onClose={() => {
            setSelectedAgent(null);
            setIsNewAgent(false);
          }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
