/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  MoreHorizontal,
  Trash2,
  Edit,
  MessageSquare,
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
import { ModelConfigDialog, modelFieldClasses } from './ModelConfigDialog';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { ModelDefaultSummary } from './ModelDefaultSummary';
import { normalizeModelIdForRuntimeProvider, resolveRuntimeProviderKey, splitModelRef } from '@/lib/model-options';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
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
const labelClasses = 'text-sm text-foreground/80 font-medium';
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
    setDefaultAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [runtimeDefaultModel, setRuntimeDefaultModel] = useState<string | null | undefined>(undefined);
  const runtimeDefaultAccount = useMemo(() => {
    const parsed = splitModelRef(runtimeDefaultModel);
    if (!parsed) return undefined;
    const matches = accounts.filter(account => resolveRuntimeProviderKey(account) === parsed.providerKey);
    return matches.find(account => account.id === defaultAccountId) ?? matches[0];
  }, [accounts, defaultAccountId, runtimeDefaultModel]);
  const defaultRowAccountId = runtimeDefaultModel === undefined ? defaultAccountId : runtimeDefaultAccount?.id;
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

      // Auto-set as default if no default is currently configured
      if (!defaultAccountId) {
        await setDefaultAccount(id);
      }

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
      <div className="flex items-center justify-between">
        <h2 data-testid="providers-settings-title" className="flex items-center gap-2 text-lg font-sans text-foreground font-medium tracking-normal">
          <MessageSquare aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
          {t('aiProviders.title', 'AI Providers')}
        </h2>
        <Button ref={addTriggerRef} data-testid="providers-add-button" onClick={() => setShowAddDialog(true)} className="rounded-md px-3 h-9 shadow-none font-medium text-meta">
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.add')}
        </Button>
      </div>

      <ModelDefaultSummary accounts={accounts} statuses={statuses} vendors={vendors} defaultAccountId={defaultAccountId} onModelLoaded={setRuntimeDefaultModel} />

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
          <Button onClick={() => setShowAddDialog(true)} className="rounded-full px-6 h-10 bg-brand hover:bg-brand-hover text-white">
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-surface-modal">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              allProviders={displayProviders}
              isDefault={item.account.id === defaultRowAccountId}
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
  isDefault: boolean;
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
  isDefault,
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
  const menuRef = useRef<HTMLButtonElement>(null);
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
    <div data-testid={`provider-card-${account.id}`} className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
          {getProviderIconUrl(account.vendorId)
            ? <img src={getProviderIconUrl(account.vendorId)} alt="" className={cn('h-5 w-5', shouldInvertInDark(account.vendorId) && 'dark:invert')} />
            : <Key className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className="truncate rounded text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => { editTriggerRef.current = event.currentTarget; onEdit(); }}>{account.label}</button>
            {isDefault && <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-white/10">{t('aiProviders.card.default')}</span>}
          </div>
          <p data-testid={`provider-model-${account.id}`} className="mt-0.5 truncate text-xs text-muted-foreground" title={models.join(', ')}>{modelSummary}{models.length > 2 && ` +${models.length - 2}`}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="truncate">{host || vendor?.name || account.vendorId}</span><span aria-hidden="true">·</span><span className="shrink-0">{hasConfiguredCredentials(account, status) ? t('aiProviders.card.configured') : t('aiProviders.card.noKey')}</span></p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button ref={menuRef} data-testid={`provider-more-${account.id}`} variant="ghost" size="icon" className="h-8 w-8" aria-label={t('aiProviders.card.more')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="clawx-menu-list min-w-40 rounded-xl border border-border bg-surface-modal p-1.5 shadow-xl">
            <DropdownMenu.Item data-testid={`provider-edit-${account.id}`} onSelect={() => { editTriggerRef.current = menuRef.current; onEdit(); }} className="clawx-menu-item flex items-center gap-2 text-sm"><Edit className="h-3.5 w-3.5" />{t('aiProviders.card.editKey')}</DropdownMenu.Item>
            <DropdownMenu.Item data-testid={`provider-delete-${account.id}`} onSelect={onDelete} className="clawx-menu-item flex items-center gap-2 text-sm text-destructive"><Trash2 className="h-3.5 w-3.5" />{t('aiProviders.card.delete')}</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
        </div>
      </div>
      <ModelConfigDialog open={isEditing} onClose={onCancelEdit} title={t('modelManagement.editService')} description={t('modelManagement.editServiceHint')} testId={`provider-edit-dialog-${account.id}`} busy={busy} returnFocusRef={editTriggerRef}
        footer={<><Button data-testid={`provider-edit-cancel-${account.id}`} variant="outline" className="h-9" disabled={busy} onClick={onCancelEdit}>{t('aiProviders.dialog.cancel')}</Button><Button data-testid={`provider-edit-save-${account.id}`} className="h-9" onClick={() => void handleSaveEdits()} disabled={busy || !displayName.trim() || !dirty}>{busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{t('aiProviders.dialog.save')}</Button></>}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="space-y-1.5"><Label htmlFor={`provider-name-${account.id}`}>{t('aiProviders.dialog.displayName')}</Label><Input id={`provider-name-${account.id}`} value={displayName} onChange={event => setDisplayName(event.target.value)} className={inputClasses} maxLength={120} /></div>
          {effectiveDocsUrl && <a href={effectiveDocsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">{t('aiProviders.dialog.customDoc')}<ExternalLink className="h-3 w-3" /></a>}
          <ProviderConnectionFields prefix={`provider-${account.id}`} baseUrl={baseUrl} onBaseUrlChange={setBaseUrl} modelId={modelId} onModelChange={setModelId} protocol={apiProtocol} onProtocolChange={setApiProtocol} showBaseUrl={!!typeInfo?.showBaseUrl} showModel={showModelIdField || models.length > 0} showProtocol={account.vendorId === 'custom'} modelLocked configuredModels={models} modelTestId={`provider-edit-models-${account.id}`} modelHelpTestId={`provider-edit-models-help-${account.id}`} baseUrlTestId={`provider-edit-base-url-${account.id}`} />
          <div className="space-y-1.5">
            <Label htmlFor={`provider-key-${account.id}`}>{t('aiProviders.dialog.replaceApiKey')}</Label>
            <p className="text-xs text-muted-foreground">{hasConfiguredCredentials(account, status) ? t('aiProviders.dialog.apiKeyConfigured') : t('aiProviders.dialog.apiKeyMissing')}</p>
            <div className="relative"><Input id={`provider-key-${account.id}`} data-testid={`provider-edit-key-input-${account.id}`} type={showKey ? 'text' : 'password'} autoComplete="off" value={newKey} onChange={event => { setNewKey(event.target.value); setValidationError(null); }} placeholder={account.vendorId === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.dialog.replaceApiKeyHelp')} className={cn(inputClasses, 'pr-10')} /><button type="button" aria-label={t(showKey ? 'aiProviders.dialog.hideKey' : 'aiProviders.dialog.showKey')} onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
            {validationError && <p role="alert" data-testid={`provider-edit-validation-error-${account.id}`} className="text-xs text-red-700 dark:text-red-400">{validationError}</p>}
          </div>
          <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('aiProviders.dialog.advancedConfig')}</summary><div className="mt-4 space-y-4">
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
  const { t, i18n } = useTranslation('settings');
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
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');
  const [prevOpen, setPrevOpen] = useState(open);
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setSelectedType(null);
      setName('');
      setApiKey('');
      setBaseUrl('');
      setModelId('');
      setApiProtocol('openai-completions');
      setShowAdvancedConfig(false);
      setUserAgent('');
      setCodePlanMode('apikey');
      setShowKey(false);
      setSaving(false);
      setValidationError(null);
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setOauthError(null);
      setAuthMode('apikey');
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
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const selectedVendor = selectedType ? vendorMap.get(selectedType) : undefined;
  const showUserAgentInAddDialog = shouldShowUserAgentFieldForNewProvider(selectedType);
  const preferredOAuthMode = selectedVendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (selectedVendor?.supportedAuthModes.includes('oauth_device')
      ? 'oauth_device'
      : null);
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && !oauthUiHidden && (!supportsApiKey || authMode === 'oauth');

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    if (oauthUiHidden) {
      setAuthMode('apikey');
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey, oauthUiHidden]);

  useEffect(() => {
    if (!typeInfo?.codePlanPresetBaseUrl || !typeInfo?.codePlanPresetModelId) {
      setCodePlanMode('apikey');
      return;
    }
    setCodePlanMode(
      isCodePlanMode(
        baseUrl,
        modelId,
        typeInfo.codePlanPresetBaseUrl,
        typeInfo.codePlanPresetModelId,
      ) ? 'codeplan' : 'apikey'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleCode = (payload: OAuthCodeEvent) => {
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
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;
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
      setOauthError(getOAuthErrorMessage(data.message, latestRef.current.t));
      setOauthData(null);
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
    if (!selectedType) return;

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

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType;
      pendingOAuthRef.current = { accountId, label };
      await hostApi.providers.requestOAuth({
        ['provider']: selectedType,
        accountId,
        label,
      });
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApi.providers.cancelOAuth();
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) return;
    try {
      await hostApi.providers.submitOAuth({ code: value });
      setOauthError(null);
    } catch (error) {
      setOauthError(String(error));
    }
  };

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

  const sortedTypes = [...availableTypes].sort((a, b) => Number(b.id === 'custom') - Number(a.id === 'custom'));

  const handleAdd = async () => {
    if (!selectedType) return;

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

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      const normalizedApiKey = normalizeProviderApiKeyInput(apiKey);
      if (requiresKey && !normalizedApiKey) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && normalizedApiKey) {
        const result = await onValidateKey(selectedType, normalizedApiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          modelId: modelId.trim() || undefined,
        });
        if (!result.valid) {
          setValidationError(getProviderValidationError(result, t));
          setSaving(false);
          return;
        }
      }

      const requiresModel = showModelIdField;
      if (requiresModel && !modelId.trim()) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
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
          authMode: useOAuthFlow ? (preferredOAuthMode || 'oauth_device') : selectedType === 'ollama'
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

  return (
    <ModelConfigDialog open={open} onClose={onClose} title={t('aiProviders.dialog.title')} description={t('aiProviders.dialog.desc')} testId="add-provider-dialog" busy={saving} returnFocusRef={returnFocusRef}
      footer={selectedType && !useOAuthFlow ? (
              <div data-testid="add-provider-footer" className="flex justify-end gap-2">
                <Button variant="outline" className="h-9" disabled={saving} onClick={onClose}>{t('aiProviders.dialog.cancel')}</Button>
                <Button
                  data-testid="add-provider-submit-button"
                  onClick={handleAdd}
                  className={cn("rounded-md px-4 h-9 text-sm font-medium shadow-none", useOAuthFlow && "hidden")}
                  disabled={!selectedType || saving || (showModelIdField && modelId.trim().length === 0)}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t('aiProviders.dialog.add')}
                </Button>
              </div>
        ) : undefined}
    >
          {!selectedType ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sortedTypes.map((type) => (
                <button
                  data-testid={`add-provider-type-${type.id}`}
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type.id);
                    setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
                    setBaseUrl(type.defaultBaseUrl || '');
                    setModelId(type.defaultModelId || '');
                    setUserAgent('');
                    setShowAdvancedConfig(false);
                    setCodePlanMode('apikey');
                  }}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="h-8 w-8 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-lg">
                    {getProviderIconUrl(type.id) ? (
                      <img src={getProviderIconUrl(type.id)} alt={type.name} className={cn('h-6 w-6', shouldInvertInDark(type.id) && 'dark:invert')} />
                    ) : (
                      <span className="text-2xl">{type.icon}</span>
                    )}
                  </div>
                  <p className="font-medium text-meta">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                </button>
              ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-transparent border-0">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl">
                  {getProviderIconUrl(selectedType!) ? (
                    <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className={cn('h-6 w-6', shouldInvertInDark(selectedType!) && 'dark:invert')} />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                  <button
                  data-testid="add-provider-change-type"
                  onClick={() => {
                    setSelectedType(null);
                    setValidationError(null);
                    setBaseUrl('');
                    setModelId('');
                    setUserAgent('');
                    setShowAdvancedConfig(false);
                    setCodePlanMode('apikey');
                  }}
                  className="text-meta text-blue-500 hover:text-blue-600 font-medium"
                >
                    {t('aiProviders.dialog.change')}
                  </button>
                  {effectiveDocsUrl && (
                    <>
                      <span className="mx-2 text-foreground/20">|</span>
                      <a
                        href={effectiveDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-meta text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.customDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-4 bg-transparent p-0">
                <div className="space-y-2">
                  <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    data-testid="add-provider-name-input"
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClasses}
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && !oauthUiHidden && (
                  <div className="flex rounded-xl border border-black/10 dark:border-white/10 overflow-hidden text-meta font-medium shadow-sm bg-transparent p-1 gap-1">
                    <button
                      data-testid="add-provider-auth-oauth-tab"
                      onClick={() => setAuthMode('oauth')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'oauth' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.loginMode')}
                    </button>
                    <button
                      data-testid="add-provider-auth-apikey-tab"
                      onClick={() => setAuthMode('apikey')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'apikey' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
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
                      <Label htmlFor="apiKey" className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-meta text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                          tabIndex={-1}
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
                        placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className={inputClasses}
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
                      <p className="text-meta text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                <ProviderConnectionFields prefix="add-provider" baseUrl={baseUrl} onBaseUrlChange={setBaseUrl} modelId={modelId} onModelChange={value => { setModelId(value); setValidationError(null); }} protocol={apiProtocol} onProtocolChange={setApiProtocol} showBaseUrl={!!typeInfo?.showBaseUrl} showModel={showModelIdField} showProtocol={selectedType === 'custom'} modelPlaceholder={typeInfo?.id === 'custom' ? 'model-id' : typeInfo?.modelIdPlaceholder} modelTestId="add-provider-model-id-input" baseUrlTestId="add-provider-base-url-input" />
                {codePlanPreset && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className={labelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                      {typeInfo?.codePlanDocsUrl && (
                        <a
                          href={typeInfo.codePlanDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-meta text-blue-500 hover:text-blue-600 font-medium inline-flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.dialog.codePlanDoc')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2 text-meta">
                      <button
                        type="button"
                        data-testid="add-provider-codeplan-apikey-tab"
                        onClick={() => {
                          setCodePlanMode('apikey');
                          setBaseUrl(typeInfo?.defaultBaseUrl || '');
                          if (modelId.trim() === codePlanPreset.modelId) {
                            setModelId(typeInfo?.defaultModelId || '');
                          }
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", codePlanMode === 'apikey' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.authModes.apiKey')}
                      </button>
                      <button
                        type="button"
                        data-testid="add-provider-codeplan-mode-tab"
                        onClick={() => {
                          setCodePlanMode('codeplan');
                          setBaseUrl(codePlanPreset.baseUrl);
                          setModelId(codePlanPreset.modelId);
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", codePlanMode === 'codeplan' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.dialog.codePlanMode')}
                      </button>
                    </div>
                    {codePlanMode === 'codeplan' && (
                      <p className="text-xs text-muted-foreground">
                        {t('aiProviders.dialog.codePlanPresetDesc', {
                          baseUrl: codePlanPreset.baseUrl,
                          modelId: codePlanPreset.modelId,
                        })}
                      </p>
                    )}
                  </div>
                )}
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
                {/* Device OAuth Trigger — only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5 text-center">
                      <p className="text-meta font-medium text-blue-600 dark:text-blue-400 mb-4 block">
                        {t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        data-testid="add-provider-oauth-login-button"
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing}
                        className="w-full rounded-full h-[42px] font-semibold bg-brand hover:bg-brand-hover text-white shadow-sm"
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
                      <div className="mt-4 p-5 border border-black/10 dark:border-white/10 rounded-2xl bg-surface-modal shadow-sm relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-sm">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-meta opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 rounded-full px-6 h-9">
                                {t('aiProviders.oauth.tryAgain')}
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
                              <p className="text-meta font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'manual' ? (
                            <div className="space-y-4 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-base text-foreground">{t('aiProviders.oauth.completeBrowserLogin')}</h3>
                                <p className="text-meta text-muted-foreground text-left bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  {oauthData.message || t('aiProviders.oauth.manualCallbackHelp')}
                                </p>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => hostApi.shell.openExternal(oauthData.authorizationUrl)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openAuthorizationPage')}
                              </Button>

                              <Input
                                placeholder={t('aiProviders.oauth.callbackPlaceholder')}
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                className={inputClasses}
                              />

                              <Button
                                className="w-full rounded-full h-[42px] font-semibold bg-brand hover:bg-brand-hover text-white"
                                onClick={handleSubmitManualOAuthCode}
                                disabled={!manualCodeInput.trim()}
                              >
                                {t('aiProviders.oauth.submitCode')}
                              </Button>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                {t('aiProviders.oauth.cancel')}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-base text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="text-meta text-muted-foreground text-left mt-2 space-y-1.5 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-center gap-3 p-4 bg-transparent border border-black/5 dark:border-white/5 rounded-xl shadow-inner">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode);
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => hostApi.shell.openExternal(oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-meta font-medium text-muted-foreground pt-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                {t('aiProviders.oauth.cancel')}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>


            </div>
          )}
    </ModelConfigDialog>
  );
}
