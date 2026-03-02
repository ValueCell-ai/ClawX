/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  Star,
  Key,
  ExternalLink,
  Copy,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useProviderStore, type ProviderConfig, type ProviderWithKeyInfo } from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  type ProviderModelCostConfig,
  type ProviderType,
  getProviderIconUrl,
  resolveProviderApiKeyForSave,
  shouldInvertInDark,
} from '@/lib/providers';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const DEFAULT_MODEL_COST: ProviderModelCostConfig = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function parseModelInput(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatModelInput(value?: string[]): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  return value.join(', ');
}

function formatOptionalNumber(value?: number): string {
  return value === undefined ? '' : String(value);
}

function parseCostField(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parsePositiveIntegerField(value: string): number | undefined | null {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const {
    providers,
    defaultProviderId,
    loading,
    fetchProviders,
    addProvider,
    deleteProvider,
    updateProviderWithKey,
    setDefaultProvider,
    validateApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);

  // Fetch providers on mount
  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      reasoning?: boolean;
      input?: string[];
      cost?: ProviderModelCostConfig;
      contextWindow?: number;
      maxTokens?: number;
    }
  ) => {
    // Only custom supports multiple instances.
    // Built-in providers remain singleton by type.
    const id = type === 'custom' ? `custom-${crypto.randomUUID()}` : type;
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await addProvider(
        {
          id,
          type,
          name,
          baseUrl: options?.baseUrl,
          model: options?.model,
          reasoning: options?.reasoning,
          input: options?.input,
          cost: options?.cost,
          contextWindow: options?.contextWindow,
          maxTokens: options?.maxTokens,
          enabled: true,
        },
        effectiveApiKey
      );

      // Auto-set as default if no default is currently configured
      if (!defaultProviderId) {
        await setDefaultProvider(id);
      }

      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteProvider(providerId);
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultProvider(providerId);
      toast.success(t('aiProviders.toast.defaultUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.add')}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Key className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('aiProviders.empty.title')}</h3>
            <p className="text-muted-foreground text-center mb-4">
              {t('aiProviders.empty.desc')}
            </p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('aiProviders.empty.cta')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isDefault={provider.id === defaultProviderId}
              isEditing={editingProvider === provider.id}
              onEdit={() => setEditingProvider(provider.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(provider.id)}
              onSetDefault={() => handleSetDefault(provider.id)}
              onSaveEdits={async (payload) => {
                await updateProviderWithKey(
                  provider.id,
                  payload.updates || {},
                  payload.newApiKey
                );
                setEditingProvider(null);
              }}
              onValidateKey={(key, options) => validateApiKey(provider.id, key, options)}
            />
          ))}
        </div>
      )}

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          existingTypes={new Set(providers.map((p) => p.type))}
          onClose={() => setShowAddDialog(false)}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateApiKey(type, key, options)}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  provider: ProviderWithKeyInfo;
  isDefault: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
}



function ProviderCard({
  provider,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onSaveEdits,
  onValidateKey,
}: ProviderCardProps) {
  const { t } = useTranslation('settings');
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl || '');
  const [modelId, setModelId] = useState(provider.model || '');
  const [reasoning, setReasoning] = useState(provider.reasoning ?? false);
  const [inputTypes, setInputTypes] = useState(formatModelInput(provider.input));
  const [costInput, setCostInput] = useState(formatOptionalNumber(provider.cost?.input));
  const [costOutput, setCostOutput] = useState(formatOptionalNumber(provider.cost?.output));
  const [costCacheRead, setCostCacheRead] = useState(formatOptionalNumber(provider.cost?.cacheRead));
  const [costCacheWrite, setCostCacheWrite] = useState(formatOptionalNumber(provider.cost?.cacheWrite));
  const [contextWindow, setContextWindow] = useState(
    provider.contextWindow !== undefined ? String(provider.contextWindow) : ''
  );
  const [maxTokens, setMaxTokens] = useState(
    provider.maxTokens !== undefined ? String(provider.maxTokens) : ''
  );
  const [showEditMoreSettings, setShowEditMoreSettings] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === provider.type);
  const canEditConfig = Boolean(typeInfo?.showBaseUrl || typeInfo?.showModelId);
  const isCustomProvider = provider.type === 'custom';

  useEffect(() => {
    if (isEditing) {
      setNewKey('');
      setShowKey(false);
      setBaseUrl(provider.baseUrl || '');
      setModelId(provider.model || '');
      setReasoning(provider.reasoning ?? false);
      setInputTypes(formatModelInput(provider.input));
      setCostInput(formatOptionalNumber(provider.cost?.input));
      setCostOutput(formatOptionalNumber(provider.cost?.output));
      setCostCacheRead(formatOptionalNumber(provider.cost?.cacheRead));
      setCostCacheWrite(formatOptionalNumber(provider.cost?.cacheWrite));
      setContextWindow(provider.contextWindow !== undefined ? String(provider.contextWindow) : '');
      setMaxTokens(provider.maxTokens !== undefined ? String(provider.maxTokens) : '');
      setShowEditMoreSettings(false);
    }
  }, [isEditing, provider.baseUrl, provider.model, provider.reasoning, provider.input, provider.cost, provider.contextWindow, provider.maxTokens]);

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};

      if (newKey.trim()) {
        setValidating(true);
        const result = await onValidateKey(newKey, {
          baseUrl: baseUrl.trim() || undefined,
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      if (canEditConfig) {
        if (typeInfo?.showModelId && !modelId.trim()) {
          toast.error(t('aiProviders.toast.modelRequired'));
          setSaving(false);
          return;
        }

        const updates: Partial<ProviderConfig> = {};
        if ((baseUrl.trim() || undefined) !== (provider.baseUrl || undefined)) {
          updates.baseUrl = baseUrl.trim() || undefined;
        }
        if ((modelId.trim() || undefined) !== (provider.model || undefined)) {
          updates.model = modelId.trim() || undefined;
        }
        if (isCustomProvider) {
          const useAdvancedSettings = showEditMoreSettings;
          const hasAnyCostField = useAdvancedSettings && [costInput, costOutput, costCacheRead, costCacheWrite]
            .some((value) => value.trim().length > 0);
          let nextCost: ProviderModelCostConfig | undefined;
          if (hasAnyCostField) {
            const nextCostInput = parseCostField(costInput);
            const nextCostOutput = parseCostField(costOutput);
            const nextCostCacheRead = parseCostField(costCacheRead);
            const nextCostCacheWrite = parseCostField(costCacheWrite);
            if (
              nextCostInput === null
              || nextCostOutput === null
              || nextCostCacheRead === null
              || nextCostCacheWrite === null
            ) {
              toast.error(t('aiProviders.toast.invalidCost'));
              setSaving(false);
              return;
            }
            nextCost = {
              input: nextCostInput ?? DEFAULT_MODEL_COST.input,
              output: nextCostOutput ?? DEFAULT_MODEL_COST.output,
              cacheRead: nextCostCacheRead ?? DEFAULT_MODEL_COST.cacheRead,
              cacheWrite: nextCostCacheWrite ?? DEFAULT_MODEL_COST.cacheWrite,
            };
          }

          const parsedContextWindow = useAdvancedSettings ? parsePositiveIntegerField(contextWindow) : undefined;
          const parsedMaxTokens = useAdvancedSettings ? parsePositiveIntegerField(maxTokens) : undefined;
          if (useAdvancedSettings && (parsedContextWindow === null || parsedMaxTokens === null)) {
            toast.error(t('aiProviders.toast.invalidTokenLimits'));
            setSaving(false);
            return;
          }

          if (useAdvancedSettings) {
            const parsedInput = inputTypes.trim() ? parseModelInput(inputTypes) : undefined;
            if ((provider.reasoning ?? false) !== reasoning) {
              updates.reasoning = reasoning;
            }
            if (JSON.stringify(parsedInput) !== JSON.stringify(provider.input ?? undefined)) {
              updates.input = parsedInput;
            }
            if (JSON.stringify(nextCost) !== JSON.stringify(provider.cost ?? undefined)) {
              updates.cost = nextCost;
            }
            if ((provider.contextWindow ?? undefined) !== parsedContextWindow) {
              updates.contextWindow = parsedContextWindow;
            }
            if ((provider.maxTokens ?? undefined) !== parsedMaxTokens) {
              updates.maxTokens = parsedMaxTokens;
            }
          }
        }
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (provider.type === 'ollama' && !provider.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(provider.type, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onCancelEdit();
        setSaving(false);
        return;
      }

      await onSaveEdits(payload);
      setNewKey('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const hasCustomAdvancedChanges =
    isCustomProvider && (
      reasoning !== (provider.reasoning ?? false)
      || inputTypes !== formatModelInput(provider.input)
      || costInput !== formatOptionalNumber(provider.cost?.input)
      || costOutput !== formatOptionalNumber(provider.cost?.output)
      || costCacheRead !== formatOptionalNumber(provider.cost?.cacheRead)
      || costCacheWrite !== formatOptionalNumber(provider.cost?.cacheWrite)
      || contextWindow !== (provider.contextWindow !== undefined ? String(provider.contextWindow) : '')
      || maxTokens !== (provider.maxTokens !== undefined ? String(provider.maxTokens) : '')
    );

  return (
    <Card className={cn(isDefault && 'ring-2 ring-primary')}>
      <CardContent className="p-4">
        {/* Top row: icon + name */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {getProviderIconUrl(provider.type) ? (
              <img src={getProviderIconUrl(provider.type)} alt={typeInfo?.name || provider.type} className={cn('h-5 w-5', shouldInvertInDark(provider.type) && 'dark:invert')} />
            ) : (
              <span className="text-xl">{typeInfo?.icon || '⚙️'}</span>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{provider.name}</span>
              </div>
              <span className="text-xs text-muted-foreground capitalize">{provider.type}</span>
            </div>
          </div>
        </div>

        {/* Key row */}
        {isEditing ? (
          <div className="space-y-2">
            {canEditConfig && (
              <>
                {typeInfo?.showBaseUrl && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="h-9 text-sm"
                    />
                  </div>
                )}
                {typeInfo?.showModelId && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t('aiProviders.dialog.modelId')}</Label>
                    <Input
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      placeholder={typeInfo.modelIdPlaceholder || 'provider/model-id'}
                      className="h-9 text-sm"
                    />
                  </div>
                )}
              </>
            )}
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start mb-1">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="pr-10 h-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {isCustomProvider && (
              <div className="space-y-3 rounded-md border border-border/70 p-3 mt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('aiProviders.dialog.moreSettings')}</Label>
                  <Switch checked={showEditMoreSettings} onCheckedChange={setShowEditMoreSettings} />
                </div>
                {showEditMoreSettings && (
                  <div className="ml-2 pl-3 border-l border-border/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.reasoning')}</Label>
                      <Switch checked={reasoning} onCheckedChange={setReasoning} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.inputTypes')}</Label>
                      <Input
                        value={inputTypes}
                        onChange={(e) => setInputTypes(e.target.value)}
                        placeholder="text,image"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.costInput')}</Label>
                        <Input value={costInput} onChange={(e) => setCostInput(e.target.value)} className="h-9 text-sm" inputMode="decimal" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.costOutput')}</Label>
                        <Input value={costOutput} onChange={(e) => setCostOutput(e.target.value)} className="h-9 text-sm" inputMode="decimal" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.costCacheRead')}</Label>
                        <Input value={costCacheRead} onChange={(e) => setCostCacheRead(e.target.value)} className="h-9 text-sm" inputMode="decimal" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.costCacheWrite')}</Label>
                        <Input value={costCacheWrite} onChange={(e) => setCostCacheWrite(e.target.value)} className="h-9 text-sm" inputMode="decimal" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.contextWindow')}</Label>
                        <Input value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} className="h-9 text-sm" inputMode="numeric" placeholder="200000" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-muted-foreground">{t('aiProviders.dialog.maxTokens')}</Label>
                        <Input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className="h-9 text-sm" inputMode="numeric" placeholder="8192" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveEdits}
                disabled={
                  validating
                  || saving
                  || (
                    !newKey.trim()
                    && (baseUrl.trim() || undefined) === (provider.baseUrl || undefined)
                    && (modelId.trim() || undefined) === (provider.model || undefined)
                    && !hasCustomAdvancedChanges
                  )
                  || Boolean(typeInfo?.showModelId && !modelId.trim())
                }
              >
                {validating || saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelEdit}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {typeInfo?.isOAuth ? (
                <>
                  <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Badge variant="secondary" className="text-xs shrink-0">{t('aiProviders.card.configured')}</Badge>
                </>
              ) : (
                <>
                  <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-mono text-muted-foreground truncate">
                    {provider.hasKey
                      ? (provider.keyMasked && provider.keyMasked.length > 12
                        ? `${provider.keyMasked.substring(0, 4)}...${provider.keyMasked.substring(provider.keyMasked.length - 4)}`
                        : provider.keyMasked)
                      : t('aiProviders.card.noKey')}
                  </span>
                  {provider.hasKey && (
                    <Badge variant="secondary" className="text-xs shrink-0">{t('aiProviders.card.configured')}</Badge>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-0.5 shrink-0 ml-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={isDefault ? undefined : onSetDefault}
                title={isDefault ? t('aiProviders.card.default') : t('aiProviders.card.setDefault')}
                disabled={isDefault}
              >
                <Star
                  className={cn(
                    'h-3.5 w-3.5 transition-colors',
                    isDefault
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-muted-foreground'
                  )}
                />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title={t('aiProviders.card.editKey')}>
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title={t('aiProviders.card.delete')}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AddProviderDialogProps {
  existingTypes: Set<string>;
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      reasoning?: boolean;
      input?: string[];
      cost?: ProviderModelCostConfig;
      contextWindow?: number;
      maxTokens?: number;
    }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
}

function AddProviderDialog({ existingTypes, onClose, onAdd, onValidateKey }: AddProviderDialogProps) {
  const { t } = useTranslation('settings');
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [reasoning, setReasoning] = useState(false);
  const [inputTypes, setInputTypes] = useState('');
  const [costInput, setCostInput] = useState('');
  const [costOutput, setCostOutput] = useState('');
  const [costCacheRead, setCostCacheRead] = useState('');
  const [costCacheWrite, setCostCacheWrite] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [showMoreSettings, setShowMoreSettings] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // For providers that support both OAuth and API key, let the user choose
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('oauth');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const isCustomProvider = selectedType === 'custom';
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');

  // Keep a ref to the latest values so the effect closure can access them
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      setOauthData(data as { verificationUri: string; userCode: string; expiresIn: number });
      setOauthError(null);
    };

    const handleSuccess = async () => {
      setOauthFlowing(false);
      setOauthData(null);
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // If we call add() here with undefined baseUrl, it will overwrite and erase it!
      // So we just fetch the latest list from the backend to update the UI.
      try {
        const store = useProviderStore.getState();
        await store.fetchProviders();

        // Auto-set as default if no default is currently configured
        if (!store.defaultProviderId && latestRef.current.selectedType) {
          // Provider type is expected to match provider ID for built-in OAuth providers
          await store.setDefaultProvider(latestRef.current.selectedType);
        }
      } catch (err) {
        console.error('Failed to refresh providers after OAuth:', err);
      }

      close();
      toast.success(translate('aiProviders.toast.added'));
    };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
    };

    window.electron.ipcRenderer.on('oauth:code', handleCode);
    window.electron.ipcRenderer.on('oauth:success', handleSuccess);
    window.electron.ipcRenderer.on('oauth:error', handleError);

    return () => {
      if (typeof window.electron.ipcRenderer.off === 'function') {
        window.electron.ipcRenderer.off('oauth:code', handleCode);
        window.electron.ipcRenderer.off('oauth:success', handleSuccess);
        window.electron.ipcRenderer.off('oauth:error', handleError);
      }
    };
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingTypes.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingTypes.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setOauthError(null);

    try {
      await window.electron.ipcRenderer.invoke('provider:requestOAuth', selectedType);
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setOauthError(null);
    await window.electron.ipcRenderer.invoke('provider:cancelOAuth');
  };

  // Only custom can be added multiple times.
  const availableTypes = PROVIDER_TYPE_INFO.filter(
    (t) => t.id === 'custom' || !existingTypes.has(t.id),
  );

  const handleAdd = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingTypes.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingTypes.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      if (requiresKey && !apiKey.trim()) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && apiKey) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
        });
        if (!result.valid) {
          setValidationError(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
      }

      const requiresModel = typeInfo?.showModelId ?? false;
      if (requiresModel && !modelId.trim()) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      const useAdvancedSettings = isCustomProvider && showMoreSettings;
      const parsedInput = useAdvancedSettings && inputTypes.trim()
        ? parseModelInput(inputTypes)
        : undefined;
      const hasAnyCostField = useAdvancedSettings
        && [costInput, costOutput, costCacheRead, costCacheWrite].some((value) => value.trim().length > 0);
      const parsedCostInput = hasAnyCostField ? parseCostField(costInput) : undefined;
      const parsedCostOutput = hasAnyCostField ? parseCostField(costOutput) : undefined;
      const parsedCostCacheRead = hasAnyCostField ? parseCostField(costCacheRead) : undefined;
      const parsedCostCacheWrite = hasAnyCostField ? parseCostField(costCacheWrite) : undefined;
      if (
        hasAnyCostField
        && (
          parsedCostInput === null
          || parsedCostOutput === null
          || parsedCostCacheRead === null
          || parsedCostCacheWrite === null
        )
      ) {
        setValidationError(t('aiProviders.toast.invalidCost'));
        setSaving(false);
        return;
      }

      const parsedContextWindow = useAdvancedSettings ? parsePositiveIntegerField(contextWindow) : undefined;
      const parsedMaxTokens = useAdvancedSettings ? parsePositiveIntegerField(maxTokens) : undefined;
      if (useAdvancedSettings && (parsedContextWindow === null || parsedMaxTokens === null)) {
        setValidationError(t('aiProviders.toast.invalidTokenLimits'));
        setSaving(false);
        return;
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || undefined,
          model: (typeInfo?.defaultModelId || modelId.trim()) || undefined,
          reasoning: useAdvancedSettings && reasoning ? reasoning : undefined,
          input: parsedInput,
          cost: hasAnyCostField
            ? {
              input: parsedCostInput ?? DEFAULT_MODEL_COST.input,
              output: parsedCostOutput ?? DEFAULT_MODEL_COST.output,
              cacheRead: parsedCostCacheRead ?? DEFAULT_MODEL_COST.cacheRead,
              cacheWrite: parsedCostCacheWrite ?? DEFAULT_MODEL_COST.cacheWrite,
            }
            : undefined,
          contextWindow: parsedContextWindow,
          maxTokens: parsedMaxTokens,
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <Card className="w-full max-w-md max-h-[85vh] flex flex-col">
        <CardHeader>
          <CardTitle>{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription>
            {t('aiProviders.dialog.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 overflow-y-auto">
          {!selectedType ? (
            <div className="grid grid-cols-2 gap-3">
              {availableTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type.id);
                    setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
                    setBaseUrl(type.defaultBaseUrl || '');
                    setModelId(type.defaultModelId || '');
                    setReasoning(false);
                    setInputTypes('');
                    setCostInput('');
                    setCostOutput('');
                    setCostCacheRead('');
                    setCostCacheWrite('');
                    setContextWindow('');
                    setMaxTokens('');
                    setShowMoreSettings(false);
                  }}
                  className="p-4 rounded-lg border hover:bg-accent transition-colors text-center"
                >
                  {getProviderIconUrl(type.id) ? (
                    <img src={getProviderIconUrl(type.id)} alt={type.name} className={cn('h-7 w-7 mx-auto', shouldInvertInDark(type.id) && 'dark:invert')} />
                  ) : (
                    <span className="text-2xl">{type.icon}</span>
                  )}
                  <p className="font-medium mt-2">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                {getProviderIconUrl(selectedType!) ? (
                  <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className={cn('h-7 w-7', shouldInvertInDark(selectedType!) && 'dark:invert')} />
                ) : (
                  <span className="text-2xl">{typeInfo?.icon}</span>
                )}
                <div>
                  <p className="font-medium">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                  <button
                    onClick={() => {
                      setSelectedType(null);
                      setValidationError(null);
                      setBaseUrl('');
                      setModelId('');
                      setReasoning(false);
                      setInputTypes('');
                      setCostInput('');
                      setCostOutput('');
                      setCostCacheRead('');
                      setCostCacheWrite('');
                      setContextWindow('');
                      setMaxTokens('');
                      setShowMoreSettings(false);
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {t('aiProviders.dialog.change')}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">{t('aiProviders.dialog.displayName')}</Label>
                <Input
                  id="name"
                  placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Auth mode toggle for providers supporting both */}
              {isOAuth && supportsApiKey && (
                <div className="flex rounded-lg border overflow-hidden text-sm">
                  <button
                    onClick={() => setAuthMode('oauth')}
                    className={cn(
                      'flex-1 py-2 px-3 transition-colors',
                      authMode === 'oauth' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                    )}
                  >
                    {t('aiProviders.oauth.loginMode')}
                  </button>
                  <button
                    onClick={() => setAuthMode('apikey')}
                    className={cn(
                      'flex-1 py-2 px-3 transition-colors',
                      authMode === 'apikey' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                    )}
                  >
                    {t('aiProviders.oauth.apikeyMode')}
                  </button>
                </div>
              )}

              {/* API Key input — shown for non-OAuth providers or when apikey mode is selected */}
              {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="apiKey">{t('aiProviders.dialog.apiKey')}</Label>
                    {typeInfo?.apiKeyUrl && (
                      <a
                        href={typeInfo.apiKeyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                        tabIndex={-1}
                      >
                        {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="apiKey"
                      type={showKey ? 'text' : 'password'}
                      placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setValidationError(null);
                      }}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {validationError && (
                    <p className="text-xs text-destructive">{validationError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('aiProviders.dialog.apiKeyStored')}
                  </p>
                </div>
              )}

              {typeInfo?.showBaseUrl && (
                <div className="space-y-2">
                  <Label htmlFor="baseUrl">{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    id="baseUrl"
                    placeholder="https://api.example.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
              )}

              {typeInfo?.showModelId && (
                <div className="space-y-2">
                  <Label htmlFor="modelId">{t('aiProviders.dialog.modelId')}</Label>
                  <Input
                    id="modelId"
                    placeholder={typeInfo.modelIdPlaceholder || 'provider/model-id'}
                    value={modelId}
                    onChange={(e) => {
                      setModelId(e.target.value);
                      setValidationError(null);
                    }}
                  />
                </div>
              )}
              {isCustomProvider && (
                <div className="space-y-3 rounded-md border border-border/70 p-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="moreSettings">{t('aiProviders.dialog.moreSettings')}</Label>
                    <Switch id="moreSettings" checked={showMoreSettings} onCheckedChange={setShowMoreSettings} />
                  </div>
                  {showMoreSettings && (
                    <div className="ml-2 pl-3 border-l border-border/60 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="reasoning" className="text-sm text-muted-foreground">{t('aiProviders.dialog.reasoning')}</Label>
                        <Switch id="reasoning" checked={reasoning} onCheckedChange={setReasoning} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="inputTypes" className="text-sm text-muted-foreground">{t('aiProviders.dialog.inputTypes')}</Label>
                        <Input
                          id="inputTypes"
                          placeholder="text,image"
                          value={inputTypes}
                          onChange={(e) => setInputTypes(e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label htmlFor="costInput" className="text-sm text-muted-foreground">{t('aiProviders.dialog.costInput')}</Label>
                          <Input id="costInput" inputMode="decimal" value={costInput} onChange={(e) => setCostInput(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="costOutput" className="text-sm text-muted-foreground">{t('aiProviders.dialog.costOutput')}</Label>
                          <Input id="costOutput" inputMode="decimal" value={costOutput} onChange={(e) => setCostOutput(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="costCacheRead" className="text-sm text-muted-foreground">{t('aiProviders.dialog.costCacheRead')}</Label>
                          <Input id="costCacheRead" inputMode="decimal" value={costCacheRead} onChange={(e) => setCostCacheRead(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="costCacheWrite" className="text-sm text-muted-foreground">{t('aiProviders.dialog.costCacheWrite')}</Label>
                          <Input id="costCacheWrite" inputMode="decimal" value={costCacheWrite} onChange={(e) => setCostCacheWrite(e.target.value)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label htmlFor="contextWindow" className="text-sm text-muted-foreground">{t('aiProviders.dialog.contextWindow')}</Label>
                          <Input id="contextWindow" inputMode="numeric" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} placeholder="200000" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="maxTokens" className="text-sm text-muted-foreground">{t('aiProviders.dialog.maxTokens')}</Label>
                          <Input id="maxTokens" inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="8192" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Device OAuth Trigger — only shown when in OAuth mode */}
              {useOAuthFlow && (
                <div className="space-y-4 pt-2">
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-center">
                    <p className="text-sm text-blue-200 mb-3 block">
                      {t('aiProviders.oauth.loginPrompt')}
                    </p>
                    <Button
                      onClick={handleStartOAuth}
                      disabled={oauthFlowing}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {oauthFlowing ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                      ) : (
                        t('aiProviders.oauth.loginButton')
                      )}
                    </Button>
                  </div>

                  {/* OAuth Active State Modal / Inline View */}
                  {oauthFlowing && (
                    <div className="mt-4 p-4 border rounded-xl bg-card relative overflow-hidden">
                      {/* Background pulse effect */}
                      <div className="absolute inset-0 bg-primary/5 animate-pulse" />

                      <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-4">
                        {oauthError ? (
                          <div className="text-red-400 space-y-2">
                            <XCircle className="h-8 w-8 mx-auto" />
                            <p className="font-medium">{t('aiProviders.oauth.authFailed')}</p>
                            <p className="text-sm opacity-80">{oauthError}</p>
                            <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 text-foreground">
                              Try Again
                            </Button>
                          </div>
                        ) : !oauthData ? (
                          <div className="space-y-3 py-4">
                            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                            <p className="text-sm text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                          </div>
                        ) : (
                          <div className="space-y-4 w-full">
                            <div className="space-y-1">
                              <h3 className="font-medium text-lg text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                              <div className="text-sm text-muted-foreground text-left mt-2 space-y-1">
                                <p>1. {t('aiProviders.oauth.step1')}</p>
                                <p>2. {t('aiProviders.oauth.step2')}</p>
                                <p>3. {t('aiProviders.oauth.step3')}</p>
                              </div>
                            </div>

                            <div className="flex items-center justify-center gap-2 p-3 bg-background border rounded-lg">
                              <code className="text-2xl font-mono tracking-widest font-bold text-primary">
                                {oauthData.userCode}
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  navigator.clipboard.writeText(oauthData.userCode);
                                  toast.success(t('aiProviders.oauth.codeCopied'));
                                }}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>

                            <Button
                              variant="secondary"
                              className="w-full"
                              onClick={() => window.electron.ipcRenderer.invoke('shell:openExternal', oauthData.verificationUri)}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              {t('aiProviders.oauth.openLoginPage')}
                            </Button>

                            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>{t('aiProviders.oauth.waitingApproval')}</span>
                            </div>

                            <Button variant="ghost" size="sm" className="w-full mt-2" onClick={handleCancelOAuth}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <Separator />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('aiProviders.dialog.cancel')}
            </Button>
            <Button
              onClick={handleAdd}
              className={cn(useOAuthFlow && "hidden")}
              disabled={!selectedType || saving || ((typeInfo?.showModelId ?? false) && modelId.trim().length === 0)}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t('aiProviders.dialog.add')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
