import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Loader2,
  QrCode,
  ExternalLink,
  BookOpen,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  CheckCircle,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useChannelsStore } from '@/stores/channels';

import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
  type ChannelMeta,
  type ChannelConfigField,
} from '@/types/channel';
import {
  buildQrChannelEventName,
  isCanonicalOpenClawAccountId,
  usesPluginManagedQrAccounts,
} from '@/lib/channel-alias';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelConfigModalProps {
  initialSelectedType?: ChannelType | null;
  configuredTypes?: string[];
  showChannelName?: boolean;
  allowExistingConfig?: boolean;
  allowEditAccountId?: boolean;
  existingAccountIds?: string[];
  initialConfigValues?: Record<string, string>;
  agentId?: string;
  accountId?: string;
  onClose: () => void;
  onChannelSaved?: (channelType: ChannelType) => void | Promise<void>;
}

const inputClasses = 'h-[44px] rounded-xl font-mono text-meta bg-surface-input border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-sm text-foreground/80 font-bold';
const outlineButtonClasses = 'h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground';
const primaryButtonClasses = 'h-9 text-meta font-medium rounded-full px-4 shadow-none';

export function ChannelConfigModal({
  initialSelectedType = null,
  configuredTypes = [],
  showChannelName = true,
  allowExistingConfig = true,
  allowEditAccountId = false,
  existingAccountIds = [],
  initialConfigValues,
  agentId,
  accountId,
  onClose,
  onChannelSaved,
}: ChannelConfigModalProps) {
  const { t } = useTranslation('channels');
  const { channels, addChannel, fetchChannels } = useChannelsStore();
  const [selectedType, setSelectedType] = useState<ChannelType | null>(initialSelectedType);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [channelName, setChannelName] = useState('');
  const [accountIdInput, setAccountIdInput] = useState(accountId || '');
  const [accountIdError, setAccountIdError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isExistingConfig, setIsExistingConfig] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const meta: ChannelMeta | null = selectedType ? CHANNEL_META[selectedType] : null;
  const shouldUseCredentialValidation = selectedType !== 'feishu';
  const usesManagedQrAccounts = usesPluginManagedQrAccounts(selectedType);
  const showAccountIdEditor = allowEditAccountId && !usesManagedQrAccounts;
  const resolvedAccountId = usesManagedQrAccounts
    ? (accountId ?? undefined)
    : showAccountIdEditor
      ? accountIdInput.trim()
      : (accountId ?? (agentId ? (agentId === 'main' ? 'default' : agentId) : undefined));
  const shouldLoadExistingConfig = Boolean(
    selectedType && allowExistingConfig && configuredTypes.includes(selectedType)
  );
  const accountIdForConfigLoad = shouldLoadExistingConfig ? resolvedAccountId : undefined;

  useEffect(() => {
    setSelectedType(initialSelectedType);
  }, [initialSelectedType]);

  useEffect(() => {
    setAccountIdInput(accountId || '');
    setAccountIdError(null);
  }, [accountId]);

  useEffect(() => {
    if (!selectedType) {
      setConfigValues({});
      setChannelName('');
      setIsExistingConfig(false);
      setValidationResult(null);
      setQrCode(null);
      setConnecting(false);
      setAccountIdError(null);
      return;
    }

    if (!shouldLoadExistingConfig) {
      setConfigValues({});
      setIsExistingConfig(false);
      setLoadingConfig(false);
      setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');
      return;
    }

    if (initialConfigValues) {
      setConfigValues(initialConfigValues);
      setIsExistingConfig(Object.keys(initialConfigValues).length > 0);
      setLoadingConfig(false);
      setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');
      return;
    }

    let cancelled = false;
    setLoadingConfig(true);
    setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');

    (async () => {
      try {
        const accountParam = accountIdForConfigLoad ? `?accountId=${encodeURIComponent(accountIdForConfigLoad)}` : '';
        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
          `/api/channels/config/${encodeURIComponent(selectedType)}${accountParam}`
        );
        if (cancelled) return;

        if (result.success && result.values && Object.keys(result.values).length > 0) {
          setConfigValues(result.values);
          setIsExistingConfig(true);
        } else {
          setConfigValues({});
          setIsExistingConfig(false);
        }
      } catch {
        if (!cancelled) {
          setConfigValues({});
          setIsExistingConfig(false);
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountIdForConfigLoad, initialConfigValues, selectedType, shouldLoadExistingConfig, showChannelName]);

  useEffect(() => {
    if (selectedType && !loadingConfig && showChannelName && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [selectedType, loadingConfig, showChannelName]);

  const finishSave = useCallback(async (channelType: ChannelType) => {
    const displayName = showChannelName && channelName.trim()
      ? channelName.trim()
      : CHANNEL_NAMES[channelType];
    const existingChannel = channels.find((channel) => channel.type === channelType);

    if (!existingChannel) {
      await addChannel({
        type: channelType,
        name: displayName,
        token: meta?.configFields[0]?.key ? configValues[meta.configFields[0].key] : undefined,
      });
    } else {
      await fetchChannels();
    }

    await onChannelSaved?.(channelType);
  }, [addChannel, channelName, channels, configValues, fetchChannels, meta?.configFields, onChannelSaved, showChannelName]);

  const finishSaveRef = useRef(finishSave);
  const onCloseRef = useRef(onClose);
  const translateRef = useRef(t);

  useEffect(() => {
    finishSaveRef.current = finishSave;
  }, [finishSave]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  function normalizeQrImageSource(data: { qr?: string; raw?: string }): string | null {
    const qr = typeof data.qr === 'string' ? data.qr.trim() : '';
    if (qr) {
      if (qr.startsWith('data:image') || qr.startsWith('http://') || qr.startsWith('https://')) {
        return qr;
      }
      return `data:image/png;base64,${qr}`;
    }

    const raw = typeof data.raw === 'string' ? data.raw.trim() : '';
    if (!raw) return null;
    if (raw.startsWith('data:image') || raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
    return null;
  }

  useEffect(() => {
    if (!selectedType || meta?.connectionType !== 'qr') return;
    const channelType = selectedType;

    const onQr = (...args: unknown[]) => {
      const data = args[0] as { qr?: string; raw?: string };
      const nextQr = normalizeQrImageSource(data);
      if (!nextQr) return;
      setQrCode(nextQr);
      setConnecting(false);
    };

    const onSuccess = async (...args: unknown[]) => {
      const data = args[0] as { accountId?: string } | undefined;
      void data?.accountId;
      toast.success(translateRef.current('toast.qrConnected', { name: CHANNEL_NAMES[channelType] }));
      try {
        if (channelType === 'whatsapp') {
          const saveResult = await hostApiFetch<{ success?: boolean; error?: string }>('/api/channels/config', {
            method: 'POST',
            body: JSON.stringify({ channelType: 'whatsapp', config: { enabled: true }, accountId: resolvedAccountId }),
          });
          if (!saveResult?.success) {
            throw new Error(saveResult?.error || 'Failed to save WhatsApp config');
          }
        }

        try {
          await finishSaveRef.current(channelType);
        } catch (postSaveError) {
          toast.warning(translateRef.current('toast.savedButRefreshFailed'));
          console.warn('Channel saved but post-save refresh failed:', postSaveError);
        }
        onCloseRef.current();
      } catch (error) {
        toast.error(translateRef.current('toast.configFailed', { error: String(error) }));
        setConnecting(false);
      }
    };

    const onError = (...args: unknown[]) => {
      const err = typeof args[0] === 'string'
        ? args[0]
        : String((args[0] as { message?: string } | undefined)?.message || args[0]);
      toast.error(translateRef.current('toast.qrFailed', { name: CHANNEL_NAMES[channelType], error: err }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'qr'), onQr);
    const removeSuccessListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'success'), onSuccess);
    const removeErrorListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'error'), onError);

    return () => {
      removeQrListener();
      removeSuccessListener();
      removeErrorListener();
      hostApiFetch(`/api/channels/${encodeURIComponent(channelType)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
      }).catch(() => { });
    };
  }, [meta?.connectionType, resolvedAccountId, selectedType]);

  const handleValidate = async () => {
    if (!selectedType || !shouldUseCredentialValidation) return;

    setValidating(true);
    setValidationResult(null);

    try {
      const result = await hostApiFetch<{
        success: boolean;
        valid?: boolean;
        errors?: string[];
        warnings?: string[];
        details?: Record<string, string>;
      }>('/api/channels/credentials/validate', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config: configValues }),
      });

      const warnings = result.warnings || [];
      if (result.valid && result.details) {
        const details = result.details;
        if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
        if (details.guildName) warnings.push(`Server: ${details.guildName}`);
        if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
      }

      setValidationResult({
        valid: result.valid || false,
        errors: result.errors || [],
        warnings,
      });
    } catch (error) {
      setValidationResult({
        valid: false,
        errors: [String(error)],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedType || !meta) return;

    setConnecting(true);
    setValidationResult(null);

    try {
      if (showAccountIdEditor) {
        const nextAccountId = accountIdInput.trim();
        if (!nextAccountId) {
          const message = t('account.invalidId');
          setAccountIdError(message);
          toast.error(message);
          setConnecting(false);
          return;
        }
        if (!isCanonicalOpenClawAccountId(nextAccountId)) {
          const message = t('account.invalidCanonicalId');
          setAccountIdError(message);
          toast.error(message);
          setConnecting(false);
          return;
        }
        const duplicateExists = existingAccountIds.some((id) => id === nextAccountId && id !== (accountId || '').trim());
        if (duplicateExists) {
          const message = t('account.accountIdExists', { accountId: nextAccountId });
          setAccountIdError(message);
          toast.error(message);
          setConnecting(false);
          return;
        }
        setAccountIdError(null);
      }

      if (meta.connectionType === 'qr') {
        await hostApiFetch(`/api/channels/${encodeURIComponent(selectedType)}/start`, {
          method: 'POST',
          body: JSON.stringify(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
        });
        return;
      }

      if (meta.connectionType === 'token' && shouldUseCredentialValidation) {
        const validationResponse = await hostApiFetch<{
          success: boolean;
          valid?: boolean;
          errors?: string[];
          warnings?: string[];
          details?: Record<string, string>;
        }>('/api/channels/credentials/validate', {
          method: 'POST',
          body: JSON.stringify({ channelType: selectedType, config: configValues }),
        });

        if (!validationResponse.valid) {
          setValidationResult({
            valid: false,
            errors: validationResponse.errors || ['Validation failed'],
            warnings: validationResponse.warnings || [],
          });
          setConnecting(false);
          return;
        }

        const warnings = validationResponse.warnings || [];
        if (validationResponse.details) {
          const details = validationResponse.details;
          if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
          if (details.guildName) warnings.push(`Server: ${details.guildName}`);
          if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
        }

        setValidationResult({
          valid: true,
          errors: [],
          warnings,
        });
      }

      const config: Record<string, unknown> = { ...configValues };
      const saveResult = await hostApiFetch<{
        success?: boolean;
        error?: string;
        warning?: string;
      }>('/api/channels/config', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config, accountId: resolvedAccountId }),
      });
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save channel config');
      }
      if (typeof saveResult.warning === 'string' && saveResult.warning) {
        toast.warning(saveResult.warning);
      }

      try {
        await finishSave(selectedType);
      } catch (postSaveError) {
        toast.warning(t('toast.savedButRefreshFailed'));
        console.warn('Channel saved but post-save refresh failed:', postSaveError);
      }

      toast.success(t('toast.channelSaved', { name: meta.name }));
      toast.success(t('toast.channelConnecting', { name: meta.name }));
      await new Promise((resolve) => setTimeout(resolve, 800));
      onClose();
    } catch (error) {
      toast.error(t('toast.configFailed', { error: String(error) }));
      setConnecting(false);
    }
  };

  const openDocs = () => {
    if (!meta?.docsUrl) return;
    const url = t(meta.docsUrl);
    try {
      if (window.electron?.openExternal) {
        window.electron.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    } catch {
      window.open(url, '_blank');
    }
  };

  const isFormValid = () => {
    if (!meta) return false;
    return meta.configFields
      .filter((field) => field.required)
      .every((field) => configValues[field.key]?.trim());
  };

  const updateConfigValue = (key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Card
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {selectedType
                ? isExistingConfig
                  ? t('dialog.updateTitle', { name: CHANNEL_NAMES[selectedType] })
                  : t('dialog.configureTitle', { name: CHANNEL_NAMES[selectedType] })
                : t('dialog.addTitle')}
            </CardTitle>
            <CardDescription className="text-sm mt-1 text-foreground/70">
              {selectedType && isExistingConfig
                ? t('dialog.existingDesc')
                : meta ? t(meta.description.replace('channels:', '')) : t('dialog.selectDesc')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {getPrimaryChannels().map((type) => {
                const channelMeta = CHANNEL_META[type];
                const isConfigured = configuredTypes.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={cn(
                      'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-surface-input shadow-sm',
                      isConfigured
                        ? 'border-green-500/40 bg-green-500/5 dark:bg-green-500/10'
                        : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-base font-semibold text-foreground truncate">{channelMeta.name}</p>
                        {channelMeta.isPlugin && (
                          <Badge
                            variant="secondary"
                            className="font-mono text-2xs font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
                          >
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-[1.5]">
                        {t(channelMeta.description.replace('channels:', ''))}
                      </p>
                      <p className="text-xs font-medium text-muted-foreground/80 mt-2">
                        {channelMeta.connectionType === 'qr' ? t('dialog.qrCode') : t('dialog.token')}
                      </p>
                    </div>
                    {isConfigured && (
                      <Badge className="absolute top-3 right-3 text-2xs font-medium rounded-full bg-green-600 hover:bg-green-600">
                        {t('configuredBadge')}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ) : qrCode ? (
            <div className="text-center space-y-6">
              <div className="bg-surface-input p-4 rounded-3xl inline-block shadow-sm border border-black/10 dark:border-white/10">
                {qrCode.startsWith('data:image') || qrCode.startsWith('http://') || qrCode.startsWith('https://') ? (
                  <img src={qrCode} alt="Scan QR Code" className="w-64 h-64 object-contain rounded-2xl" />
                ) : (
                  <div className="w-64 h-64 bg-white dark:bg-background rounded-2xl flex items-center justify-center">
                    <QrCode className="h-32 w-32 text-gray-400" />
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('dialog.scanQR', { name: meta?.name })}
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  className={outlineButtonClasses}
                  onClick={() => {
                    setQrCode(null);
                    void handleConnect();
                  }}
                >
                  {t('dialog.refreshCode')}
                </Button>
              </div>
            </div>
          ) : loadingConfig ? (
            <div className="flex items-center justify-center py-10 rounded-2xl bg-surface-input border border-black/10 dark:border-white/10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">{t('dialog.loadingConfig')}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {isExistingConfig && (
                <div className="bg-blue-500/10 text-blue-600 dark:text-blue-400 p-4 rounded-2xl text-sm flex items-center gap-2 border border-blue-500/20">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{t('dialog.existingHint')}</span>
                </div>
              )}

              <div className="bg-surface-input p-4 rounded-2xl space-y-4 shadow-sm border border-black/10 dark:border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={labelClasses}>{t('dialog.howToConnect')}</p>
                    <p className="text-meta text-muted-foreground mt-1">
                      {meta ? t(meta.description.replace('channels:', '')) : ''}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className={cn(outlineButtonClasses, 'h-8 px-3 shrink-0')}
                    onClick={openDocs}
                  >
                    <BookOpen className="h-3 w-3 mr-1" />
                    {t('dialog.viewDocs')}
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>
                <ol className="list-decimal pl-5 text-meta text-muted-foreground leading-relaxed space-y-1.5">
                  {meta?.instructions.map((instruction, index) => (
                    <li key={index}>{t(instruction)}</li>
                  ))}
                </ol>
              </div>

              {showChannelName && (
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('dialog.channelName')}</Label>
                  <Input
                    ref={firstInputRef}
                    id="name"
                    placeholder={t('dialog.channelNamePlaceholder', { name: meta?.name })}
                    value={channelName}
                    onChange={(event) => setChannelName(event.target.value)}
                    className={inputClasses}
                  />
                </div>
              )}

              {showAccountIdEditor && (
                <div className="space-y-2.5">
                  <Label htmlFor="account-id" className={labelClasses}>{t('account.customIdLabel')}</Label>
                  <Input
                    id="account-id"
                    value={accountIdInput}
                    onChange={(event) => {
                      setAccountIdInput(event.target.value);
                      if (accountIdError) {
                        setAccountIdError(null);
                      }
                    }}
                    placeholder={t('account.customIdPlaceholder')}
                    className={cn(inputClasses, accountIdError && 'border-destructive/50 focus-visible:ring-destructive/30')}
                  />
                  {accountIdError ? (
                    <p className="text-xs text-destructive">{accountIdError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('account.customIdHint')}</p>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {meta?.configFields.map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    value={configValues[field.key] || ''}
                    onChange={(value) => updateConfigValue(field.key, value)}
                    showSecret={showSecrets[field.key] || false}
                    onToggleSecret={() => toggleSecretVisibility(field.key)}
                  />
                ))}
              </div>

              {validationResult && (
                <div
                  className={cn(
                    'p-4 rounded-2xl text-sm border',
                    validationResult.valid
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                      : 'bg-destructive/10 text-destructive border-destructive/20'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {validationResult.valid ? (
                      <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h4 className="font-medium mb-1">
                        {validationResult.valid ? t('dialog.credentialsVerified') : t('dialog.validationFailed')}
                      </h4>
                      {validationResult.errors.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5">
                          {validationResult.errors.map((err, index) => (
                            <li key={index}>{err}</li>
                          ))}
                        </ul>
                      )}
                      {validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-1 text-green-600 dark:text-green-400 space-y-0.5">
                          {validationResult.warnings.map((info, index) => (
                            <p key={index} className="text-xs">{info}</p>
                          ))}
                        </div>
                      )}
                      {!validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-2 text-yellow-600 dark:text-yellow-500">
                          <p className="font-medium text-xs uppercase mb-1">{t('dialog.warnings')}</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {validationResult.warnings.map((warn, index) => (
                              <li key={index}>{warn}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  {meta?.connectionType === 'token' && shouldUseCredentialValidation && (
                    <Button
                      variant="outline"
                      onClick={handleValidate}
                      disabled={validating}
                      className={outlineButtonClasses}
                    >
                      {validating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t('dialog.validating')}
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          {t('dialog.validateConfig')}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      void handleConnect();
                    }}
                    disabled={connecting || !isFormValid() || (showAccountIdEditor && !accountIdInput.trim())}
                    className={primaryButtonClasses}
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {meta?.connectionType === 'qr' ? t('dialog.generatingQR') : t('dialog.validatingAndSaving')}
                      </>
                    ) : meta?.connectionType === 'qr' ? (
                      t('dialog.generateQRCode')
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        {isExistingConfig ? t('dialog.updateAndReconnect') : t('dialog.saveAndConnect')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ConfigFieldProps {
  field: ChannelConfigField;
  value: string;
  onChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[22px] h-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[22px] h-[22px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-xl">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function ConfigField({ field, value, onChange, showSecret, onToggleSecret }: ConfigFieldProps) {
  const { t } = useTranslation('channels');
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-2.5">
      <Label htmlFor={field.key} className={labelClasses}>
        {t(field.label)}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={field.key}
          type={isPassword && !showSecret ? 'password' : 'text'}
          placeholder={field.placeholder ? t(field.placeholder) : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputClasses}
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSecret}
            className="h-[44px] w-[44px] rounded-xl bg-surface-input border-black/10 dark:border-white/10 text-muted-foreground hover:text-foreground shrink-0 shadow-sm"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {field.description && (
        <p className="text-meta text-muted-foreground leading-relaxed">
          {t(field.description)}
        </p>
      )}
      {field.envVar && (
        <p className="text-xs text-muted-foreground/70 font-mono">
          {t('dialog.envVar', { var: field.envVar })}
        </p>
      )}
    </div>
  );
}
