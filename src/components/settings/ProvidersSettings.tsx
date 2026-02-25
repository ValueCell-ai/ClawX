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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useProviderStore, type ProviderConfig, type ProviderWithKeyInfo } from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  type ProviderType,
  getProviderIconUrl,
  shouldInvertInDark,
} from '@/lib/providers';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

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
    options?: { baseUrl?: string; model?: string }
  ) => {
    // Only custom supports multiple instances.
    // Built-in providers remain singleton by type.
    const id = type === 'custom' ? `custom-${crypto.randomUUID()}` : type;
    try {
      await addProvider(
        {
          id,
          type,
          name,
          baseUrl: options?.baseUrl,
          model: options?.model,
          enabled: true,
        },
        apiKey.trim() || undefined
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
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === provider.type);
  const canEditConfig = Boolean(typeInfo?.showBaseUrl || typeInfo?.showModelId);

  useEffect(() => {
    if (isEditing) {
      setNewKey('');
      setShowKey(false);
      setBaseUrl(provider.baseUrl || '');
      setModelId(provider.model || '');
    }
  }, [isEditing, provider.baseUrl, provider.model]);

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
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
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
            <div className="flex gap-2">
              <div className="relative flex-1">
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
    options?: { baseUrl?: string; model?: string }
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
      const { selectedType: type, typeInfo: info, onAdd: add, onClose: close, t: translate } = latestRef.current;
      // Save the provider to the store so the list refreshes automatically
      if (type && add) {
        try {
          await add(
            type,
            info?.name || type,
            '', // OAuth providers don't use a plain API key
            { model: info?.defaultModelId }
          );
        } catch {
          // provider may already exist; ignore duplicate errors
        }
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
    setOauthFlowing(true);
    setOauthData(null);
    setOauthError(null);

    try {
      await window.electron.ipcRenderer.invoke('provider:requestOAuth', selectedType, 'global');
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

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || undefined,
          model: (typeInfo?.defaultModelId || modelId.trim()) || undefined,
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
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription>
            {t('aiProviders.dialog.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                  <Label htmlFor="apiKey">{t('aiProviders.dialog.apiKey')}</Label>
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
