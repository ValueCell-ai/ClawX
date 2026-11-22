/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Loader2,
  Key,
  ExternalLink,
  Copy,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModelConfigDialog, modelFieldClasses, modelFieldLabelClasses } from './ModelConfigDialog';
import { ModelConfigActions, ModelConfigHeading, ModelConfigOption, ModelConfigPanels, ModelServiceIcon } from './ModelConfigPanels';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { normalizeModelIdForRuntimeProvider, resolveRuntimeProviderKey } from '@/lib/model-options';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderConfig,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  type ProviderType,
  type ProviderValidationResult,
  getProviderIconUrl,
  isProviderAvailableForLanguage,
  normalizeProviderApiKeyInput,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settings';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type { OAuthCodeEvent, OAuthErrorEvent, OAuthSuccessEvent } from '@shared/host-events/contract';

const inputClasses = modelFieldClasses;
const labelClasses = modelFieldLabelClasses;
type CodePlanMode = 'apikey' | 'codeplan';

function isZaiProviderType(type: string | undefined): boolean {
  return type === 'zai' || type === 'zai-global';
}

function normalizeFallbackProviderIds(ids?: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function fallbackProviderIdsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackProviderIds(a).sort();
  const right = normalizeFallbackProviderIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function normalizeFallbackModels(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function fallbackModelsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackModels(a);
  const right = normalizeFallbackModels(b);
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

function getUserAgentHeader(headers?: Record<string, string>): string {
  if (!headers) return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'user-agent') {
      return value;
    }
  }
  return '';
}

function mergeHeadersWithUserAgent(
  headers: Record<string, string> | undefined,
  userAgent: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== 'user-agent'),
  );
  const normalizedUserAgent = userAgent.trim();
  if (normalizedUserAgent) {
    next['User-Agent'] = normalizedUserAgent;
  }
  return next;
}

function isCodePlanMode(
  baseUrl: string | undefined,
  modelId: string | undefined,
  codePlanPresetBaseUrl?: string,
  codePlanPresetModelId?: string,
): boolean {
  if (!codePlanPresetBaseUrl || !codePlanPresetModelId) return false;
  return (baseUrl || '').trim() === codePlanPresetBaseUrl && (modelId || '').trim() === codePlanPresetModelId;
}

function shouldShowUserAgentField(account: ProviderAccount): boolean {
  return account.vendorId === 'custom';
}

function shouldShowUserAgentFieldForNewProvider(providerType: ProviderType | null): boolean {
  return providerType === 'custom';
}

function getOAuthErrorMessage(message: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (message.startsWith('tokendanceOAuth.exchangeFailed:')) {
    return t('aiProviders.oauth.tokenDanceExchangeFailed', {
      status: message.slice('tokendanceOAuth.exchangeFailed:'.length),
    });
  }
  const keyByCode: Record<string, string> = {
    'tokendanceOAuth.cancelled': 'aiProviders.oauth.tokenDanceCancelled',
    'tokendanceOAuth.callbackUnavailable': 'aiProviders.oauth.tokenDanceCallbackUnavailable',
    'tokendanceOAuth.timedOut': 'aiProviders.oauth.tokenDanceTimedOut',
    'tokendanceOAuth.missingKey': 'aiProviders.oauth.tokenDanceMissingKey',
  };
  const key = keyByCode[message];
  return key ? t(key) : message;
}

function getProviderValidationError(
  result: ProviderValidationResult,
  t: (key: string) => string,
): string {
  switch (result.recoveryAction) {
    case 'top_up_balance':
      return t('aiProviders.recovery.topUpBalance');
    case 'reauthorize_api_key':
      return t('aiProviders.recovery.reauthorizeApiKey');
    case 'api_key_quota':
      return t('aiProviders.recovery.apiKeyQuota');
    default:
      return result.error || t('aiProviders.toast.invalidKey');
  }
}

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const existingVendorIds = new Set(accounts.map((account) => account.vendorId));
  const displayProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
    }
  ) => {
    const vendor = vendorMap.get(type);
    const id = buildProviderAccountId(type, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await createAccount({
        id,
        vendorId: type,
        label: name,
        authMode: options?.authMode || vendor?.defaultAuthMode || (type === 'ollama' ? 'local' : 'api_key'),
        baseUrl: options?.baseUrl,
        apiProtocol: options?.apiProtocol,
        headers: options?.headers,
        model: options?.model,
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await removeAccount(providerId);
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  return (
    <div data-testid="providers-settings" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p data-testid="providers-settings-description" className="min-w-0 text-sm leading-relaxed text-muted-foreground">{t('aiProviders.description')}</p>
        <Button ref={addTriggerRef} data-testid="providers-add-button" onClick={() => setShowAddDialog(true)} className="h-9 shrink-0 rounded-md px-3 shadow-none font-medium text-sm">
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.add')}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 border-dashed">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : displayProviders.length === 0 ? (
        <div data-testid="providers-empty-state" className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 border-dashed">
          <Key className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-sm font-medium mb-1 text-foreground">{t('aiProviders.empty.title')}</h3>
          <p className="text-meta text-center mb-6 max-w-sm">
            {t('aiProviders.empty.desc')}
          </p>
          <Button onClick={() => setShowAddDialog(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-surface-modal px-4">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              allProviders={displayProviders}
              isEditing={editingProvider === item.account.id}
              onEdit={() => setEditingProvider(item.account.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(item.account.id)}
              onSaveEdits={async (payload) => {
                const updates: Partial<ProviderAccount> = {};
                if (payload.updates) {
                  if (payload.updates.name !== undefined) updates.label = payload.updates.name;
                  if (payload.updates.baseUrl !== undefined) updates.baseUrl = payload.updates.baseUrl;
                  if (payload.updates.apiProtocol !== undefined) updates.apiProtocol = payload.updates.apiProtocol;
                  if (payload.updates.headers !== undefined) updates.headers = payload.updates.headers;
                  if (payload.updates.model !== undefined) updates.model = payload.updates.model;
                  if (payload.updates.fallbackModels !== undefined) updates.fallbackModels = payload.updates.fallbackModels;
                  if (payload.updates.fallbackProviderIds !== undefined) {
                    updates.fallbackAccountIds = payload.updates.fallbackProviderIds;
                  }
                }
                await updateAccount(
                  item.account.id,
                  updates,
                  payload.newApiKey
                );
                setEditingProvider(null);
              }}
              onValidateKey={(key, options) => validateAccountApiKey(item.account.id, key, options)}
              devModeUnlocked={devModeUnlocked}
            />
          ))}
        </div>
      )}

      {/* Add Provider Dialog */}
      <AddProviderDialog
        open={showAddDialog}
        returnFocusRef={addTriggerRef}
        existingVendorIds={existingVendorIds}
        vendors={vendors}
        onClose={() => setShowAddDialog(false)}
        onAdd={handleAddProvider}
        onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
        devModeUnlocked={devModeUnlocked}
      />
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol']; modelId?: string }
  ) => Promise<ProviderValidationResult>;
  devModeUnlocked: boolean;
}



function ProviderCard({
  item,
  allProviders,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSaveEdits,
  onValidateKey,
  devModeUnlocked,
}: ProviderCardProps) {
  const { t, i18n } = useTranslation('settings');
  const { account, vendor, status } = item;
  const editTriggerRef = useRef<HTMLElement | null>(null);
  const [displayName, setDisplayName] = useState(account.label);
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [userAgent, setUserAgent] = useState(getUserAgentHeader(account.headers));
  const [modelId, setModelId] = useState(account.model || '');
  const [fallbackModelsText, setFallbackModelsText] = useState(
    normalizeFallbackModels(account.fallbackModels).join('\n')
  );
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codePlanMode, setCodePlanMode] = useState<CodePlanMode>('apikey');
  const [validationError, setValidationError] = useState<string | null>(null);

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const effectiveDocsUrl = codePlanMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const showUserAgentField = shouldShowUserAgentField(account);

  useEffect(() => {
    if (isEditing) {
      setDisplayName(account.label);
      setNewKey('');
      setShowKey(false);
      setBaseUrl(account.baseUrl || '');
      setApiProtocol(account.apiProtocol || 'openai-completions');
      setUserAgent(getUserAgentHeader(account.headers));
      setModelId(account.model || '');
      setFallbackModelsText(normalizeFallbackModels(account.fallbackModels).join('\n'));
      setFallbackProviderIds(normalizeFallbackProviderIds(account.fallbackAccountIds));
      setValidationError(null);
      setCodePlanMode(
        isCodePlanMode(
          account.baseUrl,
          account.model,
          typeInfo?.codePlanPresetBaseUrl,
          typeInfo?.codePlanPresetModelId,
        ) ? 'codeplan' : 'apikey'
      );
    }
  }, [isEditing, account.label, account.baseUrl, account.headers, account.fallbackModels, account.fallbackAccountIds, account.model, account.apiProtocol, account.vendorId, typeInfo?.codePlanPresetBaseUrl, typeInfo?.codePlanPresetModelId]);

  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    setValidationError(null);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};
      const normalizedFallbackModels = normalizeFallbackModels(fallbackModelsText.split('\n'));
      const normalizedNewKey = normalizeProviderApiKeyInput(newKey);

      if (normalizedNewKey) {
        setValidating(true);
        const result = await onValidateKey(normalizedNewKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (account.vendorId === 'custom' || account.vendorId === 'ollama') ? apiProtocol : undefined,
          modelId: modelId.trim() || undefined,
        });
        setValidating(false);
        if (!result.valid) {
          setValidationError(getProviderValidationError(result, t));
          setSaving(false);
          return;
        }
        payload.newApiKey = normalizedNewKey;
      }

      {
        const updates: Partial<ProviderConfig> = {};
        if (displayName.trim() && displayName.trim() !== account.label) updates.name = displayName.trim();
        if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
          updates.baseUrl = baseUrl.trim() || undefined;
        }
        if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && apiProtocol !== account.apiProtocol) {
          updates.apiProtocol = apiProtocol;
        }
        const existingUserAgent = getUserAgentHeader(account.headers).trim();
        const nextUserAgent = userAgent.trim();
        if (nextUserAgent !== existingUserAgent) {
          updates.headers = mergeHeadersWithUserAgent(account.headers, nextUserAgent);
        }
        if (!fallbackModelsEqual(normalizedFallbackModels, account.fallbackModels)) {
          updates.fallbackModels = normalizedFallbackModels;
        }
        if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
          updates.fallbackProviderIds = normalizeFallbackProviderIds(fallbackProviderIds);
        }
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (account.vendorId === 'ollama' && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
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

  const busy = saving || validating;
  const dirty = Boolean(newKey.trim())
    || displayName.trim() !== account.label
    || baseUrl.trim() !== (account.baseUrl || '')
    || apiProtocol !== (account.apiProtocol || 'openai-completions')
    || userAgent.trim() !== getUserAgentHeader(account.headers).trim()
    || !fallbackModelsEqual(normalizeFallbackModels(fallbackModelsText.split('\n')), account.fallbackModels)
    || !fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds);
  const modelSources = account.metadata?.customModels?.length ? account.metadata.customModels : [account.model];
  const models = [...new Set(modelSources.map(model => normalizeModelIdForRuntimeProvider(model, resolveRuntimeProviderKey(account))).filter(Boolean))];
  let host = '';
  try { host = account.baseUrl ? new URL(account.baseUrl).host : ''; } catch { /* Keep invalid saved URLs editable. */ }
  const modelSummary = models.length ? models.slice(0, 2).join(', ') : t('aiProviders.overview.noModelSelected');
  return (
    <div data-testid={`provider-card-${account.id}`} className="py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
          {getProviderIconUrl(account.vendorId)
            ? <img src={getProviderIconUrl(account.vendorId)} alt="" className={cn('h-5 w-5', shouldInvertInDark(account.vendorId) && 'dark:invert')} />
            : <Key className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className="truncate rounded text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => { editTriggerRef.current = event.currentTarget; onEdit(); }}>{account.label}</button>
          </div>
          <p data-testid={`provider-model-${account.id}`} className="mt-0.5 truncate text-meta text-muted-foreground" title={models.join(', ')}>{modelSummary}{models.length > 2 && ` +${models.length - 2}`}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-meta text-muted-foreground"><span className="truncate">{host || vendor?.name || account.vendorId}</span>{!hasConfiguredCredentials(account, status) && <><span aria-hidden="true">·</span><span className="shrink-0">{t('aiProviders.card.noKey')}</span></>}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip disableHoverableContent>
            <TooltipTrigger asChild><Button data-testid={`provider-edit-${account.id}`} type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={t('aiProviders.card.editKey')} onClick={event => { editTriggerRef.current = event.currentTarget; onEdit(); }}><Edit aria-hidden="true" className="h-4 w-4" /></Button></TooltipTrigger>
            <TooltipContent>{t('aiProviders.card.editKey')}</TooltipContent>
          </Tooltip>
          <Tooltip disableHoverableContent>
            <TooltipTrigger asChild><Button data-testid={`provider-delete-${account.id}`} type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={t('aiProviders.card.delete')} onClick={onDelete}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button></TooltipTrigger>
            <TooltipContent>{t('aiProviders.card.delete')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <ModelConfigDialog open={isEditing} onClose={onCancelEdit} title={t('modelManagement.editService')} description={t('modelManagement.editServiceHint')} testId={`provider-edit-dialog-${account.id}`} busy={busy} returnFocusRef={editTriggerRef}
        footer={<><Button data-testid={`provider-edit-cancel-${account.id}`} variant="outline" className="h-9" disabled={busy} onClick={onCancelEdit}>{t('aiProviders.dialog.cancel')}</Button><Button data-testid={`provider-edit-save-${account.id}`} className="h-9" onClick={() => void handleSaveEdits()} disabled={busy || !displayName.trim() || !dirty}>{busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{t('aiProviders.dialog.save')}</Button></>}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="space-y-1.5"><Label htmlFor={`provider-name-${account.id}`}>{t('aiProviders.dialog.displayName')}</Label><Input id={`provider-name-${account.id}`} value={displayName} onChange={event => setDisplayName(event.target.value)} className={inputClasses} maxLength={120} /></div>
          {effectiveDocsUrl && <a href={effectiveDocsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">{t('aiProviders.dialog.customDoc')}<ExternalLink className="h-3 w-3" /></a>}
          <ProviderConnectionFields prefix={`provider-${account.id}`} baseUrl={baseUrl} onBaseUrlChange={setBaseUrl} modelId={modelId} onModelChange={setModelId} protocol={apiProtocol} onProtocolChange={setApiProtocol} showBaseUrl={!!typeInfo?.showBaseUrl} showModel={showModelIdField || models.length > 0} showProtocol={account.vendorId === 'custom'} modelLocked configuredModels={models} modelTestId={`provider-edit-models-${account.id}`} baseUrlTestId={`provider-edit-base-url-${account.id}`} />
          <div className="space-y-1.5">
            <Label htmlFor={`provider-key-${account.id}`}>{t('aiProviders.dialog.replaceApiKey')}</Label>
            {!hasConfiguredCredentials(account, status) && <p data-testid={`provider-edit-key-status-${account.id}`} className="text-xs text-muted-foreground">{t('aiProviders.dialog.apiKeyMissing')}</p>}
            <div className="relative"><Input id={`provider-key-${account.id}`} data-testid={`provider-edit-key-input-${account.id}`} type={showKey ? 'text' : 'password'} autoComplete="off" value={newKey} onChange={event => { setNewKey(event.target.value); setValidationError(null); }} placeholder={account.vendorId === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.dialog.replaceApiKeyHelp')} className={cn(inputClasses, 'pr-10')} /><button type="button" aria-label={t(showKey ? 'aiProviders.dialog.hideKey' : 'aiProviders.dialog.showKey')} onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
            {validationError && <p role="alert" data-testid={`provider-edit-validation-error-${account.id}`} className="text-xs text-red-700 dark:text-red-400">{validationError}</p>}
          </div>
          <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium text-muted-foreground">{t('aiProviders.dialog.advancedConfig')}</summary><div className="mt-4 space-y-4">
            {showUserAgentField && <div className="space-y-1.5"><Label htmlFor={`provider-ua-${account.id}`}>{t('aiProviders.dialog.userAgent')}</Label><Input id={`provider-ua-${account.id}`} value={userAgent} onChange={event => setUserAgent(event.target.value)} placeholder={t('aiProviders.dialog.userAgentPlaceholder')} className={inputClasses} /></div>}
            <div className="space-y-1.5"><Label htmlFor={`provider-fallbacks-${account.id}`}>{t('aiProviders.dialog.fallbackModelIds')}</Label><textarea id={`provider-fallbacks-${account.id}`} value={fallbackModelsText} onChange={event => setFallbackModelsText(event.target.value)} placeholder={t('aiProviders.dialog.fallbackModelIdsPlaceholder')} className="min-h-20 w-full rounded-lg border border-input bg-surface-modal px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/10" /><p className="text-xs text-muted-foreground">{t('aiProviders.dialog.fallbackModelIdsHelp')}</p></div>
            <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t('aiProviders.dialog.fallbackProviders')}</legend>{fallbackOptions.length ? fallbackOptions.map(candidate => <label key={candidate.account.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fallbackProviderIds.includes(candidate.account.id)} onChange={() => toggleFallbackProvider(candidate.account.id)} />{candidate.account.label}</label>) : <p className="text-xs text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions')}</p>}</fieldset>
          </div></details>
        </fieldset>
      </ModelConfigDialog>
    </div>
  );
}

interface AddProviderDialogProps {
  open: boolean;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
    }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol']; modelId?: string }
  ) => Promise<ProviderValidationResult>;
  devModeUnlocked: boolean;
}

function AddProviderDialog({
  open,
  returnFocusRef,
  existingVendorIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [codePlanMode, setCodePlanMode] = useState<CodePlanMode>('apikey');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState<string>();
  const [modelError, setModelError] = useState<string>();
  const connectionDrafts = useRef<Partial<Record<CodePlanMode, { baseUrl: string; modelId: string }>>>({});

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    mode: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | {
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  } | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);
  const [oauthCancelling, setOauthCancelling] = useState(false);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');
  const [prevOpen, setPrevOpen] = useState(false);
  const pendingOAuthRef = useRef<{ accountId: string; provider: ProviderType } | null>(null);
  const oauthPanelRef = useRef<HTMLDivElement | null>(null);

  const clearServiceDraft = () => {
    setApiKey('');
    setShowKey(false);
    setApiProtocol('openai-completions');
    setUserAgent('');
    setShowAdvancedConfig(false);
    setValidationError(null);
    setBaseUrlError(undefined);
    setModelError(undefined);
    connectionDrafts.current = {};
  };

  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    // Skip providers that are temporarily hidden or unavailable in this UI language.
    if (type.hidden) return false;
    if (!isProviderAvailableForLanguage(type, i18n.resolvedLanguage || i18n.language)) return false;

    // MiniMax portal variants are mutually exclusive — hide BOTH variants
    // when either one already exists (account may have vendorId of either variant).
    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((type.id === 'minimax-portal' || type.id === 'minimax-portal-cn') && hasMinimax) return false;

    // Z.AI CN/Global both map to OpenClaw key `zai` — mutually exclusive in the UI.
    const hasZai = existingVendorIds.has('zai') || existingVendorIds.has('zai-global');
    if (isZaiProviderType(type.id) && hasZai) return false;

    const vendor = vendorMap.get(type.id);
    if (!vendor) {
      return !existingVendorIds.has(type.id) || type.id === 'custom';
    }
    return vendor.supportsMultipleAccounts || !existingVendorIds.has(type.id);
  });

  const chooseService = (type: typeof PROVIDER_TYPE_INFO[number]) => {
    clearServiceDraft();
    const defaultBaseUrl = type.defaultBaseUrl || '';
    const defaultModelId = type.defaultModelId || '';
    const vendor = vendorMap.get(type.id);
    setSelectedType(type.id);
    setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
    setBaseUrl(defaultBaseUrl);
    setModelId(defaultModelId);
    setAuthMode(!type.hideOAuthUi && vendor && vendor.defaultAuthMode !== 'api_key' ? 'oauth' : 'apikey');
    setCodePlanMode(isCodePlanMode(defaultBaseUrl, defaultModelId, type.codePlanPresetBaseUrl, type.codePlanPresetModelId) ? 'codeplan' : 'apikey');
  };

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      const initialService = availableTypes.find(type => type.id === 'openai') ?? availableTypes[0];
      if (initialService) chooseService(initialService);
      else setSelectedType(null);
      setSaving(false);
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setOauthError(null);
      setOauthSubmitting(false);
      setOauthCancelling(false);
      pendingOAuthRef.current = null;
    }
  }

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = codePlanMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const oauthUiHidden = typeInfo?.hideOAuthUi ?? false;
  const canChooseAuthMode = isOAuth && supportsApiKey && !oauthUiHidden;
  const showUserAgentInAddDialog = shouldShowUserAgentFieldForNewProvider(selectedType);
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && !oauthUiHidden && (!supportsApiKey || authMode === 'oauth');
  const oauthPending = useOAuthFlow && oauthFlowing;
  const requiresApiKey = !useOAuthFlow && (!!typeInfo?.requiresApiKey || canChooseAuthMode);
  const isOllama = selectedType === 'ollama';
  const fieldsLocked = saving || oauthPending;

  const chooseConnectionPreset = (mode: CodePlanMode) => {
    if (!codePlanPreset || mode === codePlanMode) return;
    connectionDrafts.current[codePlanMode] = { baseUrl, modelId };
    const nextDraft = connectionDrafts.current[mode] ?? (mode === 'codeplan' ? codePlanPreset : {
      baseUrl: typeInfo?.defaultBaseUrl || '',
      modelId: typeInfo?.defaultModelId || '',
    });
    setCodePlanMode(mode);
    setBaseUrl(nextDraft.baseUrl);
    setModelId(nextDraft.modelId);
    setBaseUrlError(undefined);
    setModelError(undefined);
    setValidationError(null);
  };

  const validateDraft = () => {
    const url = baseUrl.trim();
    let urlMessage: string | undefined;
    if (selectedType === 'custom' && !url) {
      urlMessage = t('aiProviders.dialog.baseUrlRequired');
    } else if (typeInfo?.showBaseUrl && url) {
      const parsed = URL.canParse(url) ? new URL(url) : null;
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || !/^https?:\/\//i.test(url)) {
        urlMessage = t('aiProviders.dialog.baseUrlInvalid');
      }
    }
    const modelMessage = showModelIdField && !modelId.trim()
      ? t('aiProviders.toast.modelRequired')
      : showModelIdField && /[,，]/.test(modelId)
        ? t('aiProviders.dialog.modelIdSingle')
        : undefined;
    const keyMessage = requiresApiKey && !normalizeProviderApiKeyInput(apiKey)
      ? t('aiProviders.dialog.apiKeyRequired')
      : null;
    setBaseUrlError(urlMessage);
    setModelError(modelMessage);
    setValidationError(keyMessage);
    return !(urlMessage || modelMessage || keyMessage);
  };

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = useRef({ onClose, t });
  useEffect(() => {
    latestRef.current = { onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleCode = (payload: OAuthCodeEvent) => {
      if (payload.provider !== pendingOAuthRef.current?.provider) return;
      if ('mode' in payload && payload.mode === 'manual') {
        setOauthData({
          mode: 'manual',
          authorizationUrl: payload.authorizationUrl,
          message: payload.message,
        });
      } else {
        setOauthData({
          mode: 'device',
          verificationUri: payload.verificationUri,
          userCode: payload.userCode,
          expiresIn: payload.expiresIn,
        });
      }
      setOauthError(null);
    };

    const handleSuccess = (payload: OAuthSuccessEvent) => {
      if (payload.accountId !== pendingOAuthRef.current?.accountId) return;
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setOauthSubmitting(false);
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;
      const { accountId } = payload;
      pendingOAuthRef.current = null;

      // The Main process only emits success after credentials are persisted.
      // Close immediately so runtime synchronization does not make a successful
      // browser OAuth flow appear stuck in the UI.
      close();
      toast.success(translate('aiProviders.toast.added'));

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // Refresh and select it without delaying success feedback.
      void (async () => {
        try {
          const store = useProviderStore.getState();
          await store.refreshProviderSnapshot();

          if (accountId) {
            await store.setDefaultAccount(accountId);
          }
        } catch (err) {
          console.error('Failed to refresh providers after OAuth:', err);
          toast.error(translate('aiProviders.toast.failedDefault'));
        }
      })();
    };

    const handleError = (data: OAuthErrorEvent) => {
      if (!pendingOAuthRef.current) return;
      setOauthError(getOAuthErrorMessage(data.message, latestRef.current.t));
      setOauthData(null);
      setOauthSubmitting(false);
      pendingOAuthRef.current = null;
    };

    const offCode = hostEvents.onOAuthCode(handleCode);
    const offSuccess = hostEvents.onOAuthSuccess(handleSuccess);
    const offError = hostEvents.onOAuthError(handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
      if (pendingOAuthRef.current) {
        pendingOAuthRef.current = null;
        void hostApi.providers.cancelOAuth();
      }
    };
  }, [open]);

  const handleStartOAuth = async () => {
    if (!selectedType || pendingOAuthRef.current) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    const hasZai = existingVendorIds.has('zai') || existingVendorIds.has('zai-global');
    if (isZaiProviderType(selectedType) && hasZai) {
      toast.error(t('aiProviders.toast.zaiConflict'));
      return;
    }

    if (!validateDraft()) return;
    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    setOauthSubmitting(false);

    const vendor = vendorMap.get(selectedType);
    const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
    const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
    const label = name.trim() || typeInfo?.name || selectedType;
    const pending = { accountId, provider: selectedType };
    pendingOAuthRef.current = pending;
    try {
      const result = await hostApi.providers.requestOAuth({
        provider: selectedType,
        accountId,
        label,
        modelId: showModelIdField ? modelId.trim() : undefined,
      });
      if (!result.success) throw new Error(result.error || t('aiProviders.oauth.authFailed'));
    } catch (error) {
      if (pendingOAuthRef.current !== pending) return;
      setOauthError(getOAuthErrorMessage(error instanceof Error ? error.message : String(error), t));
      setOauthData(null);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    const pending = pendingOAuthRef.current;
    setOauthCancelling(true);
    try {
      if (pending) {
        const result = await hostApi.providers.cancelOAuth();
        if (!result.success) throw new Error(result.error || t('aiProviders.oauth.authFailed'));
        if (pendingOAuthRef.current === pending) pendingOAuthRef.current = null;
      }
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setOauthError(null);
      setOauthSubmitting(false);
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : String(error));
    } finally {
      setOauthCancelling(false);
    }
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    const pending = pendingOAuthRef.current;
    if (!value || !pending || oauthSubmitting) return;
    setOauthSubmitting(true);
    setOauthError(null);
    try {
      const result = await hostApi.providers.submitOAuth({ code: value });
      if (!result.success) throw new Error(result.error || t('aiProviders.oauth.authFailed'));
    } catch (error) {
      if (pendingOAuthRef.current === pending) {
        setOauthError(error instanceof Error ? error.message : String(error));
        setOauthSubmitting(false);
      }
    }
  };

  const customType = availableTypes.find(type => type.id === 'custom');
  const serviceFamilies = new Map<string, typeof availableTypes>();
  for (const type of availableTypes) {
    if (type.id === 'custom') continue;

    const familyId = type.id.replace(/-(cn|global)$/, '');
    const family = serviceFamilies.get(familyId);
    if (family) {
      family.push(type);
    } else {
      serviceFamilies.set(familyId, [type]);
    }
  }

  const renderServiceOption = (type: typeof PROVIDER_TYPE_INFO[number]) => {
    const region = type.name.match(/ \((?:CN|Global)\)$/)?.[0];
    return (
      <ModelConfigOption
        key={type.id}
        data-testid={`add-provider-type-${type.id}`}
        selected={selectedType === type.id}
        disabled={fieldsLocked || oauthCancelling}
        icon={<ModelServiceIcon provider={type.id} fallback={type.icon} />}
        onClick={() => {
          if (selectedType !== type.id) chooseService(type);
        }}
      >
        {type.id === 'custom' ? t('aiProviders.dialog.customService') : region ? type.name.slice(0, -region.length) : type.name}
        {region && <span className="font-normal text-muted-foreground">{region}</span>}
      </ModelConfigOption>
    );
  };

  const handleAdd = async () => {
    if (!selectedType || saving || useOAuthFlow) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    const hasZai = existingVendorIds.has('zai') || existingVendorIds.has('zai-global');
    if (isZaiProviderType(selectedType) && hasZai) {
      toast.error(t('aiProviders.toast.zaiConflict'));
      return;
    }

    if (!validateDraft()) return;

    setSaving(true);
    try {
      const normalizedApiKey = normalizeProviderApiKeyInput(apiKey);
      if (normalizedApiKey && requiresApiKey) {
        const result = await onValidateKey(selectedType, normalizedApiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          modelId: modelId.trim() || undefined,
        });
        if (!result.valid) {
          setValidationError(getProviderValidationError(result, t));
          return;
        }
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        normalizedApiKey,
        {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          headers: userAgent.trim() ? { 'User-Agent': userAgent.trim() } : undefined,
          model: resolveProviderModelForSave(typeInfo, modelId, devModeUnlocked),
          authMode: selectedType === 'ollama'
            ? 'local'
            : (isOAuth && supportsApiKey && authMode === 'apikey')
              ? 'api_key'
              : vendorMap.get(selectedType)?.defaultAuthMode || 'api_key',
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  const apiKeyField = !useOAuthFlow && (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Label htmlFor="apiKey" className={labelClasses}>
          {t('aiProviders.dialog.apiKey')}
          {isOllama && <span className="text-muted-foreground"> ({t('aiProviders.notRequired')})</span>}
        </Label>
        {typeInfo?.apiKeyUrl && (
          <a
            href={typeInfo.apiKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline font-medium flex items-center gap-1"
          >
            {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="relative">
        <Input
          data-testid="add-provider-api-key-input"
          id="apiKey"
          type={showKey ? 'text' : 'password'}
          placeholder={isOllama ? undefined : typeInfo?.placeholder}
          value={apiKey}
          disabled={saving}
          aria-invalid={!!validationError}
          aria-describedby={validationError ? 'add-provider-api-key-error' : undefined}
          onChange={(e) => {
            setApiKey(e.target.value);
            setValidationError(null);
          }}
          className={cn(inputClasses, 'pr-9')}
        />
        <button
          type="button"
          aria-label={t(showKey ? 'aiProviders.dialog.hideKey' : 'aiProviders.dialog.showKey')}
          onClick={() => setShowKey(!showKey)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {validationError && (
        <p id="add-provider-api-key-error" role="alert" className="text-sm text-destructive">{validationError}</p>
      )}
    </div>
  );

  const waitingForOAuth = oauthPending && !oauthData && !oauthError;
  useEffect(() => {
    oauthPanelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [oauthData, oauthError]);

  const waitingLabel = selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn'
    ? 'aiProviders.oauth.requestingCode'
    : 'aiProviders.oauth.waitingApproval';
  const choiceGroup = 'flex rounded-xl border border-border text-sm font-medium p-1 gap-1';
  const choiceButton = (selected: boolean) => cn(
    'min-w-0 flex-1 break-words rounded-lg px-2 py-2 transition-colors disabled:cursor-default',
    selected ? 'bg-accent text-foreground' : 'text-muted-foreground enabled:hover:bg-accent',
  );
  let submit: { label: string; testId: string; disabled: boolean; busy: boolean; onClick: () => void | Promise<void> } = {
    label: t('aiProviders.dialog.add'),
    testId: 'add-provider-submit-button',
    disabled: saving,
    busy: saving,
    onClick: handleAdd,
  };
  if (useOAuthFlow) {
    submit = {
      label: t(waitingForOAuth ? waitingLabel : oauthPending && oauthError ? 'aiProviders.oauth.tryAgain' : 'aiProviders.oauth.loginButton'),
      testId: 'add-provider-oauth-login-button',
      disabled: waitingForOAuth || oauthCancelling,
      busy: waitingForOAuth,
      onClick: handleStartOAuth,
    };
    if (oauthPending && oauthData?.mode === 'manual') {
      submit = {
        label: t(oauthSubmitting ? 'aiProviders.oauth.waitingApproval' : 'aiProviders.oauth.submitCode'),
        testId: 'add-provider-oauth-submit-code',
        disabled: !manualCodeInput.trim() || oauthSubmitting || oauthCancelling,
        busy: oauthSubmitting,
        onClick: handleSubmitManualOAuthCode,
      };
    } else if (oauthPending && oauthData?.mode === 'device') {
      const verificationUri = oauthData.verificationUri;
      submit = {
        label: t('aiProviders.oauth.openLoginPage'),
        testId: 'add-provider-oauth-open-login',
        disabled: oauthCancelling,
        busy: false,
        onClick: () => { void hostApi.shell.openExternal(verificationUri); },
      };
    }
  }

  return (
    <ModelConfigDialog open={open} onClose={onClose} title={t('aiProviders.dialog.title')} testId="add-provider-dialog" layout="split" busy={saving || oauthCancelling} returnFocusRef={returnFocusRef}
      footer={(
        <ModelConfigActions
          footerTestId="add-provider-footer"
          cancelDisabled={saving || oauthCancelling}
          onCancel={oauthPending ? handleCancelOAuth : onClose}
          label={submit.label}
          testId={submit.testId}
          onSubmit={submit.onClick}
          disabled={submit.disabled || !selectedType}
          busy={submit.busy}
          reserveLabels={['aiProviders.dialog.add', 'aiProviders.oauth.loginButton', 'aiProviders.oauth.submitCode', 'aiProviders.oauth.openLoginPage'].map(key => t(key))}
        />
      )}
    >
      <ModelConfigPanels
        label={t('aiProviders.dialog.serviceList')}
        navigationTestId="add-provider-catalog"
        listTestId="add-provider-service-list"
        detailTestId="add-provider-details"
        detailKey={selectedType ?? undefined}
        options={[...serviceFamilies.values()].flat().map(renderServiceOption)}
        trailingOption={customType && renderServiceOption(customType)}
      >
        {typeInfo && (
          <>
            <ModelConfigHeading
              title={typeInfo.id === 'custom' ? t('aiProviders.dialog.customService') : typeInfo.name}
              icon={<ModelServiceIcon provider={typeInfo.id} alt={typeInfo.name} fallback={typeInfo.icon} className="h-6 w-6" />}
            >
              {effectiveDocsUrl && (
                <a
                  href={effectiveDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {t(codePlanMode === 'codeplan' && typeInfo.codePlanDocsUrl ? 'aiProviders.dialog.codePlanDoc' : 'aiProviders.dialog.customDoc')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </ModelConfigHeading>

          <div className="space-y-4 bg-transparent p-0">
            <div className="space-y-2">
              <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
              <Input
                data-testid="add-provider-name-input"
                id="name"
                placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                value={name}
                disabled={fieldsLocked}
                onChange={(e) => setName(e.target.value)}
                className={inputClasses}
              />
            </div>

            {/* Auth mode toggle for providers supporting both */}
            {canChooseAuthMode && (
              <fieldset className="min-w-0" disabled={fieldsLocked}>
                <Label asChild className={cn(labelClasses, 'mb-2')}>
                  <legend>{t('aiProviders.oauth.method')}</legend>
                </Label>
                <div className={choiceGroup}>
                  <button
                    type="button"
                    data-testid="add-provider-auth-oauth-tab"
                    aria-pressed={authMode === 'oauth'}
                    onClick={() => setAuthMode('oauth')}
                    className={choiceButton(authMode === 'oauth')}
                  >
                    {t('aiProviders.oauth.loginMode')}
                  </button>
                  <button
                    type="button"
                    data-testid="add-provider-auth-apikey-tab"
                    aria-pressed={authMode === 'apikey'}
                    onClick={() => setAuthMode('apikey')}
                    className={choiceButton(authMode === 'apikey')}
                  >
                    {t('aiProviders.oauth.apikeyMode')}
                  </button>
                </div>
              </fieldset>
            )}

            {codePlanPreset && (
              <fieldset className="min-w-0" disabled={fieldsLocked}>
                <Label asChild className={cn(labelClasses, 'mb-2')}>
                  <legend>{t('aiProviders.dialog.connectionPreset')}</legend>
                </Label>
                <div className={choiceGroup}>
                  <button
                    type="button"
                    data-testid="add-provider-codeplan-apikey-tab"
                    aria-pressed={codePlanMode === 'apikey'}
                    onClick={() => chooseConnectionPreset('apikey')}
                    className={choiceButton(codePlanMode === 'apikey')}
                  >
                    {t('aiProviders.dialog.generalApiPreset')}
                  </button>
                  <button
                    type="button"
                    data-testid="add-provider-codeplan-mode-tab"
                    aria-pressed={codePlanMode === 'codeplan'}
                    onClick={() => chooseConnectionPreset('codeplan')}
                    className={choiceButton(codePlanMode === 'codeplan')}
                  >
                    {t('aiProviders.dialog.codePlanMode')}
                  </button>
                </div>
              </fieldset>
            )}

            {!canChooseAuthMode && !isOllama && apiKeyField}

            <ProviderConnectionFields
              prefix="add-provider"
              baseUrl={baseUrl}
              onBaseUrlChange={value => {
                setBaseUrl(value);
                setBaseUrlError(undefined);
                setValidationError(null);
              }}
              modelId={modelId}
              onModelChange={value => {
                setModelId(value);
                setModelError(undefined);
                setValidationError(null);
              }}
              protocol={apiProtocol}
              onProtocolChange={value => {
                setApiProtocol(value);
                setValidationError(null);
              }}
              showBaseUrl={!!typeInfo?.showBaseUrl}
              showModel={showModelIdField}
              showProtocol={selectedType === 'custom'}
              modelPlaceholder={typeInfo?.modelIdPlaceholder}
              modelTestId="add-provider-model-id-input"
              baseUrlTestId="add-provider-base-url-input"
              baseUrlError={baseUrlError}
              modelError={modelError}
              disabled={fieldsLocked}
            />
            {isOllama && apiKeyField}
            {showUserAgentInAddDialog && (
              <div className="space-y-2">
                <button
                  type="button"
                  aria-expanded={showAdvancedConfig}
                  onClick={() => setShowAdvancedConfig((value) => !value)}
                  className="flex items-center justify-between w-full text-sm font-bold text-foreground/80 hover:text-foreground transition-colors"
                >
                  <span>{t('aiProviders.dialog.advancedConfig')}</span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedConfig && "rotate-180")} />
                </button>
                {showAdvancedConfig && (
                  <div className="space-y-2 pt-1">
                    <Label htmlFor="userAgent" className={labelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                    <Input
                      id="userAgent"
                      placeholder={t('aiProviders.dialog.userAgentPlaceholder')}
                      value={userAgent}
                      onChange={(e) => setUserAgent(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                )}
              </div>
            )}
            {canChooseAuthMode && !oauthPending && (
              <div className="min-h-16">{apiKeyField}</div>
            )}
            {waitingForOAuth && <p role="status" className="text-sm text-muted-foreground">{submit.label}</p>}

            {oauthPending && (oauthData || oauthError) && (
              <div ref={oauthPanelRef} className="rounded-xl border border-border bg-muted/30 p-4 text-center">
                  {!oauthData ? (
                    <div role="alert" className="text-destructive space-y-2">
                      <XCircle className="h-5 w-5 mx-auto" aria-hidden="true" />
                      <p className="font-semibold text-sm">{t('aiProviders.oauth.authFailed')}</p>
                      {oauthError !== t('aiProviders.oauth.authFailed') && <p className="text-sm">{oauthError}</p>}
                    </div>
                  ) : oauthData.mode === 'manual' ? (
                    <div className="space-y-4 w-full">
                      {oauthData.message && (
                        <p className="text-meta text-muted-foreground text-left bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                          {oauthData.message}
                        </p>
                      )}

                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => hostApi.shell.openExternal(oauthData.authorizationUrl)}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        {t('aiProviders.oauth.openAuthorizationPage')}
                      </Button>

                      <Input
                        aria-label={t('aiProviders.oauth.callbackPlaceholder')}
                        placeholder={t('aiProviders.oauth.callbackPlaceholder')}
                        value={manualCodeInput}
                        disabled={oauthSubmitting || oauthCancelling}
                        onChange={(e) => setManualCodeInput(e.target.value)}
                        className={inputClasses}
                      />

                      {oauthError && <p role="alert" className="text-sm text-destructive">{oauthError}</p>}
                    </div>
                  ) : (
                    <div className="space-y-5 w-full">
                      <p className="text-meta text-muted-foreground">{t('aiProviders.oauth.enterDeviceCode')}</p>

                      <div className="flex items-center justify-center gap-3 p-4 bg-transparent border border-black/5 dark:border-white/5 rounded-xl shadow-inner">
                        <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                          {oauthData.userCode}
                        </code>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                              aria-label={t('common:actions.copy')}
                              onClick={() => {
                                navigator.clipboard.writeText(oauthData.userCode);
                                toast.success(t('aiProviders.oauth.codeCopied'));
                              }}
                            >
                              <Copy className="h-5 w-5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('common:actions.copy')}</TooltipContent>
                        </Tooltip>
                      </div>

                      {oauthError && <p role="alert" className="text-sm text-destructive">{oauthError}</p>}

                      <div role="status" className="flex items-center justify-center gap-2 text-meta font-medium text-muted-foreground pt-2">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        <span>{t('aiProviders.oauth.waitingApproval')}</span>
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
          </>
        )}
      </ModelConfigPanels>
    </ModelConfigDialog>
  );
}
