/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useProviderStore, type ProviderConfig, type ProviderWithKeyInfo } from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  type ProviderType,
} from '@/lib/providers';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function ProvidersSettings() {
  const { 
    providers, 
    defaultProviderId, 
    loading, 
    fetchProviders, 
    addProvider,
    updateProvider,
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

      // Auto-set as default if this is the first provider
      if (providers.length === 0) {
        await setDefaultProvider(id);
      }

      setShowAddDialog(false);
      toast.success('Provider added successfully');
    } catch (error) {
      toast.error(`Failed to add provider: ${error}`);
    }
  };
  
  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteProvider(providerId);
      toast.success('Provider deleted');
    } catch (error) {
      toast.error(`Failed to delete provider: ${error}`);
    }
  };
  
  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultProvider(providerId);
      toast.success('Default provider updated');
    } catch (error) {
      toast.error(`Failed to set default: ${error}`);
    }
  };
  
  const handleToggleEnabled = async (provider: ProviderWithKeyInfo) => {
    try {
      await updateProvider(provider.id, { enabled: !provider.enabled });
    } catch (error) {
      toast.error(`Failed to update provider: ${error}`);
    }
  };
  
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
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
            <h3 className="text-lg font-medium mb-2">No providers configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add an AI provider to start using ClawX
            </p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Provider
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
              onToggleEnabled={() => handleToggleEnabled(provider)}
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
  onToggleEnabled: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
}

/**
 * Shorten a masked key to a more readable format.
 * e.g. "sk-or-v1-a20a****df67" -> "sk-...df67"
 */
function shortenKeyDisplay(masked: string | null): string {
  if (!masked) return 'No key';
  // Show first 4 chars + last 4 chars
  if (masked.length > 12) {
    const prefix = masked.substring(0, 4);
    const suffix = masked.substring(masked.length - 4);
    return `${prefix}...${suffix}`;
  }
  return masked;
}

function ProviderCard({
  provider,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onToggleEnabled,
  onSaveEdits,
  onValidateKey,
}: ProviderCardProps) {
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
          toast.error(result.error || 'Invalid API key');
          setSaving(false);
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      if (canEditConfig) {
        if (typeInfo?.showModelId && !modelId.trim()) {
          toast.error('Model ID is required');
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
      toast.success('Provider updated');
    } catch (error) {
      toast.error(`Failed to save provider: ${error}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };
  
  return (
    <Card className={cn(isDefault && 'ring-2 ring-primary')}>
      <CardContent className="p-4">
        {/* Top row: icon + name + toggle */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">{typeInfo?.icon || '⚙️'}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{provider.name}</span>
                {isDefault && (
                  <Badge variant="default" className="text-xs">Default</Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground capitalize">{provider.type}</span>
            </div>
          </div>
          <Switch
            checked={provider.enabled}
            onCheckedChange={onToggleEnabled}
          />
        </div>
        
        {/* Key row */}
        {isEditing ? (
          <div className="space-y-2">
            {canEditConfig && (
              <>
                {typeInfo?.showBaseUrl && (
                  <div className="space-y-1">
                    <Label className="text-xs">Base URL</Label>
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
                    <Label className="text-xs">Model ID</Label>
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
                  placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : 'Optional: update API key'}
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
              <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-mono text-muted-foreground truncate">
                {provider.hasKey ? shortenKeyDisplay(provider.keyMasked) : 'No API key set'}
              </span>
              {provider.hasKey && (
                <Badge variant="secondary" className="text-xs shrink-0">Configured</Badge>
              )}
            </div>
            <div className="flex gap-0.5 shrink-0 ml-2">
              {!isDefault && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSetDefault} title="Set as default">
                  <Star className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit API key">
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title="Delete provider">
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
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  
  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);

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
        setValidationError('API key is required');
        setSaving(false);
        return;
      }
      if (requiresKey && apiKey) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
        });
        if (!result.valid) {
          setValidationError(result.error || 'Invalid API key');
          setSaving(false);
          return;
        }
      }

      const requiresModel = typeInfo?.showModelId ?? false;
      if (requiresModel && !modelId.trim()) {
        setValidationError('Model ID is required');
        setSaving(false);
        return;
      }

      await onAdd(
        selectedType,
        name || typeInfo?.name || selectedType,
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
          <CardTitle>Add AI Provider</CardTitle>
          <CardDescription>
            Configure a new AI model provider
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
                    setName(type.name);
                    setBaseUrl(type.defaultBaseUrl || '');
                    setModelId(type.defaultModelId || '');
                  }}
                  className="p-4 rounded-lg border hover:bg-accent transition-colors text-center"
                >
                  <span className="text-2xl">{type.icon}</span>
                  <p className="font-medium mt-2">{type.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <span className="text-2xl">{typeInfo?.icon}</span>
                <div>
                  <p className="font-medium">{typeInfo?.name}</p>
                  <button 
                    onClick={() => {
                      setSelectedType(null);
                      setValidationError(null);
                      setBaseUrl('');
                      setModelId('');
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Change provider
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  placeholder={typeInfo?.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.placeholder}
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
                  Your API key is stored locally on your machine.
                </p>
              </div>

              {typeInfo?.showBaseUrl && (
                <div className="space-y-2">
                  <Label htmlFor="baseUrl">Base URL</Label>
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
                  <Label htmlFor="modelId">Model ID</Label>
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
            </div>
          )}
          
          <Separator />
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleAdd} 
              disabled={!selectedType || saving || ((typeInfo?.showModelId ?? false) && modelId.trim().length === 0)}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Add Provider
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
