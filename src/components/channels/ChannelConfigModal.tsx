import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Loader2,
  QrCode,
  ExternalLink,
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
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

import { hostApi, type DingTalkWorkspaceAuthResult } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import type { ChannelErrorEvent, ChannelQrEvent, ChannelSuccessEvent } from '@shared/host-events/contract';
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
  openDingTalkWorkspaceAuth?: boolean;
  agentId?: string;
  accountId?: string;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onChannelSaved?: (channelType: ChannelType) => void | Promise<void>;
}

const inputClasses = 'h-9 rounded-lg bg-surface-modal font-sans text-sm shadow-none';
const labelClasses = 'text-sm font-medium';

export function ChannelConfigModal({
  initialSelectedType = null,
  configuredTypes = [],
  showChannelName = true,
  allowExistingConfig = true,
  allowEditAccountId = false,
  existingAccountIds = [],
  initialConfigValues,
  openDingTalkWorkspaceAuth = false,
  agentId,
  accountId,
  returnFocusTo,
  onClose: onDismiss,
  onChannelSaved,
}: ChannelConfigModalProps) {
  const { t, i18n } = useTranslation('channels');
  const [open, setOpen] = useState(true);
  const onClose = useCallback(() => setOpen(false), []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedType, setSelectedType] = useState<ChannelType | null>(initialSelectedType);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [channelName, setChannelName] = useState('');
  const [accountIdInput, setAccountIdInput] = useState(accountId || '');
  const [accountIdError, setAccountIdError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [showRequiredErrors, setShowRequiredErrors] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isExistingConfig, setIsExistingConfig] = useState(false);
  const [dingtalkWorkspaceAuth, setDingtalkWorkspaceAuth] = useState<DingTalkWorkspaceAuthResult | null>(
    openDingTalkWorkspaceAuth ? { success: true, status: 'needs_auth' } : null,
  );
  const dingtalkWorkspaceAuthActiveRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const meta: ChannelMeta | null = selectedType ? CHANNEL_META[selectedType] : null;
  const shouldUseCredentialValidation = meta?.connectionType === 'token';
  const isFeishu = selectedType === 'feishu';
  const isWhatsApp = selectedType === 'whatsapp';
  const missingFeishuField = isFeishu
    ? meta?.configFields.find((field) => field.required && !configValues[field.key]?.trim())
    : undefined;

  // Main returns stable error codes next to its English fallback text so the
  // modal can show localized messages (e.g. Feishu App Secret pasted as App ID).
  const localizeValidationErrors = useCallback((response: {
    errors?: string[];
    errorCodes?: Array<{ code: string; params?: Record<string, string> }>;
  }): string[] => {
    const fallback = response.errors ?? [];
    if (!response.errorCodes?.length) return fallback;
    return response.errorCodes.map(({ code, params }, index) => {
      const key = `dialog.validationErrors.${code}`;
      const localized = t(key, { ...params, defaultValue: '' });
      return localized || fallback[index] || fallback[0] || code;
    });
  }, [t]);
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
        const result = await hostApi.channels.formValues(
          selectedType,
          accountIdForConfigLoad,
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
    await onChannelSaved?.(channelType);
  }, [onChannelSaved]);

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

  const completeDingtalkWorkspaceAuth = useCallback(async () => {
    dingtalkWorkspaceAuthActiveRef.current = false;
    toast.success(translateRef.current('dialog.dingtalkWorkspaceAuthSuccess'));
    // Refresh the configured channel view so the authorization reminder and
    // its action disappear as soon as DWS reports success.
    await finishSaveRef.current('dingtalk');
    onCloseRef.current();
  }, []);

  useEffect(() => () => {
    if (dingtalkWorkspaceAuthActiveRef.current) {
      void hostApi.channels.dingtalkWorkspaceAuthCancel(resolvedAccountId);
    }
  }, [resolvedAccountId]);

  useEffect(() => {
    if (dingtalkWorkspaceAuth?.status !== 'pending' && dingtalkWorkspaceAuth?.status !== 'starting') return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await hostApi.channels.dingtalkWorkspaceAuthStatus(resolvedAccountId);
        if (stopped) return;
        setDingtalkWorkspaceAuth(result);
        if (result.status === 'authorized') {
          await completeDingtalkWorkspaceAuth();
        }
      } catch {
        // The active CLI process remains authoritative; retry on the next tick.
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [completeDingtalkWorkspaceAuth, dingtalkWorkspaceAuth?.status, resolvedAccountId]);

  const startDingtalkWorkspaceAuth = useCallback(async () => {
    setDingtalkWorkspaceAuth({ success: true, status: 'starting' });
    dingtalkWorkspaceAuthActiveRef.current = true;
    try {
      const result = await hostApi.channels.dingtalkWorkspaceAuthStart(resolvedAccountId);
      setDingtalkWorkspaceAuth(result);
      if (result.status === 'authorized') {
        await completeDingtalkWorkspaceAuth();
        return;
      }
      // Device flow does not open a browser itself. Desktop loopback OAuth
      // does, so only auto-open here when DWS returned a device user code.
      if (result.status === 'pending' && result.verificationUriComplete && result.userCode) {
        void hostApi.shell.openExternal(result.verificationUriComplete).catch(() => {});
      }
    } catch {
      setDingtalkWorkspaceAuth({ success: false, status: 'error', errorCode: 'authorization_failed' });
    }
  }, [completeDingtalkWorkspaceAuth, resolvedAccountId]);

  const skipDingtalkWorkspaceAuth = useCallback(() => {
    dingtalkWorkspaceAuthActiveRef.current = false;
    void hostApi.channels.dingtalkWorkspaceAuthCancel(resolvedAccountId);
    onClose();
  }, [onClose, resolvedAccountId]);

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
    if (!open || !selectedType || meta?.connectionType !== 'qr') return;
    const channelType = selectedType;

    const onQr = (data: ChannelQrEvent) => {
      const nextQr = normalizeQrImageSource(data);
      if (!nextQr) return;
      setQrCode(nextQr);
      setConnecting(false);
    };

    const onSuccess = async (data: ChannelSuccessEvent) => {
      void data?.accountId;
      toast.success(translateRef.current('toast.qrConnected', { name: CHANNEL_NAMES[channelType] }));
      try {
        if (channelType === 'whatsapp') {
          const saveResult = await hostApi.channels.saveConfig({
            channelType: 'whatsapp',
            config: { enabled: true },
            accountId: resolvedAccountId,
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

    const onError = (payload: ChannelErrorEvent) => {
      const err = typeof payload === 'string'
        ? payload
        : String(payload.message || payload);
      toast.error(translateRef.current('toast.qrFailed', { name: CHANNEL_NAMES[channelType], error: err }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = hostEvents.onChannelQr(channelType, onQr);
    const removeSuccessListener = hostEvents.onChannelSuccess(channelType, onSuccess);
    const removeErrorListener = hostEvents.onChannelError(channelType, onError);

    return () => {
      removeQrListener();
      removeSuccessListener();
      removeErrorListener();
      hostApi.channels.cancelLogin(channelType, resolvedAccountId ? { accountId: resolvedAccountId } : undefined)
        .catch(() => { });
    };
  }, [meta?.connectionType, open, resolvedAccountId, selectedType]);

  const handleValidate = async () => {
    if (!selectedType || !shouldUseCredentialValidation) return;

    setValidationResult(null);
    if (missingFeishuField) {
      setShowRequiredErrors(true);
      dialogRef.current?.querySelector<HTMLInputElement>(`#${missingFeishuField.key}`)?.focus();
      return;
    }

    setValidating(true);
    try {
      const result = await hostApi.channels.validateCredentials(selectedType, configValues, resolvedAccountId);

      const warnings = result.warnings || [];
      if (result.valid && result.details) {
        const details = result.details;
        if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
        if (details.guildName) warnings.push(`Server: ${details.guildName}`);
        if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
      }

      setValidationResult({
        valid: result.valid || false,
        errors: localizeValidationErrors(result),
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
        await hostApi.channels.startLogin(selectedType, resolvedAccountId ? { accountId: resolvedAccountId } : undefined);
        return;
      }

      let discoveredDomain: string | undefined;
      if (meta.connectionType === 'token' && shouldUseCredentialValidation) {
        const validationResponse = await hostApi.channels.validateCredentials(
          selectedType,
          configValues,
          resolvedAccountId,
        );

        if (!validationResponse.valid) {
          const errors = localizeValidationErrors(validationResponse);
          setValidationResult({
            valid: false,
            errors: errors.length > 0 ? errors : [t('dialog.validationFailed')],
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
          if (typeof details.domain === 'string' && details.domain.trim()) {
            discoveredDomain = details.domain.trim();
          }
        }

        setValidationResult({
          valid: true,
          errors: [],
          warnings,
        });
      }

      const config: Record<string, unknown> = { ...configValues };
      if (discoveredDomain) {
        config.domain = discoveredDomain;
      }
      const saveResult = await hostApi.channels.saveConfig({ channelType: selectedType, config, accountId: resolvedAccountId });
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save channel config');
      }
      if (typeof saveResult.warning === 'string' && saveResult.warning) {
        const warningKey = `health.reasons.${saveResult.warning}`;
        toast.warning(i18n.exists(warningKey, { ns: 'channels' }) ? t(warningKey) : saveResult.warning);
      }

      try {
        await finishSave(selectedType);
      } catch (postSaveError) {
        toast.warning(t('toast.savedButRefreshFailed'));
        console.warn('Channel saved but post-save refresh failed:', postSaveError);
      }

      toast.success(t('toast.channelSaved', { name: meta.name }));
      toast.success(t('toast.channelConnecting', { name: meta.name }));

      if (selectedType === 'dingtalk') {
        try {
          const authStatus = await hostApi.channels.dingtalkWorkspaceAuthStatus(resolvedAccountId);
          if (authStatus.status === 'needs_auth') {
            setConnecting(false);
            setDingtalkWorkspaceAuth(authStatus);
            await startDingtalkWorkspaceAuth();
            return;
          }
        } catch {
          // Workspace OAuth is optional and must never turn a successful chat
          // configuration save into a failure.
        }
      }
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
    if (isFeishu) setValidationResult(null);
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const workspaceAuth = selectedType === 'dingtalk' ? dingtalkWorkspaceAuth : null;
  const setupHint = isFeishu ? t('dialog.feishuSetupHint') : isWhatsApp ? t('dialog.whatsappSetupHint') : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        ref={dialogRef}
        className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-xl bg-surface-modal p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocusTo?.isConnected) returnFocusTo.focus();
          onDismiss();
        }}
      >
        <div className="shrink-0 px-5 pb-4 pt-5 pr-12">
          <DialogTitle ref={titleRef} tabIndex={-1} className="font-sans text-xl font-medium tracking-normal outline-none">
            {workspaceAuth
              ? t('dialog.dingtalkWorkspaceAuthTitle')
              : selectedType
                ? isExistingConfig
                  ? t('dialog.updateTitle', { name: CHANNEL_NAMES[selectedType] })
                  : t('dialog.configureTitle', { name: CHANNEL_NAMES[selectedType] })
                : t('dialog.addTitle')}
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {workspaceAuth
              ? t('dialog.dingtalkWorkspaceAuthDescription')
              : isExistingConfig
                ? t('dialog.existingDesc')
                : meta ? t(meta.description.replace('channels:', '')) : t('dialog.selectDesc')}
          </DialogDescription>
        </div>
        <DialogClose asChild>
          <Button variant="ghost" size="icon" aria-label={t('common:actions.close')} className="absolute right-3 top-3 h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </DialogClose>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
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
                      'group relative flex items-start gap-3 overflow-hidden rounded-xl border border-border bg-surface-modal p-4 text-left transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/5 text-foreground dark:bg-white/5">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col py-0.5">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="truncate text-base font-medium text-foreground">{channelMeta.name}</p>
                        {channelMeta.isPlugin && (
                          <Badge
                            variant="secondary"
                            className="font-mono text-xs font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
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
                      <Badge variant="success" className="absolute top-3 right-3">
                        {t('configuredBadge')}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ) : workspaceAuth ? (
            <div className="space-y-4" data-testid="dingtalk-workspace-auth">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                {workspaceAuth.status === 'authorized' ? (
                  <CheckCircle className="h-7 w-7" />
                ) : workspaceAuth.status === 'error' ? (
                  <AlertCircle className="h-7 w-7 text-destructive" />
                ) : (
                  <ShieldCheck className="h-7 w-7" />
                )}
              </div>

              {workspaceAuth.status === 'starting' && (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-black/10 dark:border-white/10 p-5 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('dialog.dingtalkWorkspaceAuthStarting')}
                </div>
              )}

              {workspaceAuth.status === 'pending' && (
                <div className="rounded-2xl border border-black/10 dark:border-white/10 p-5 text-center space-y-4 bg-surface-input">
                  {workspaceAuth.userCode && (
                    <>
                      <p className="text-sm text-muted-foreground">{t('dialog.dingtalkWorkspaceAuthCodeHint')}</p>
                      <p className="font-mono text-3xl tracking-widest text-foreground" data-testid="dingtalk-workspace-code">
                        {workspaceAuth.userCode}
                      </p>
                    </>
                  )}
                  {workspaceAuth.verificationUriComplete && (
                    <Button
                      size="sm"
                      onClick={() => void hostApi.shell.openExternal(workspaceAuth.verificationUriComplete!)}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {t('dialog.dingtalkWorkspaceAuthOpen')}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">{t('dialog.dingtalkWorkspaceAuthWaiting')}</p>
                </div>
              )}

              {(workspaceAuth.status === 'error' || workspaceAuth.status === 'unavailable') && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                  {t(`dialog.dingtalkWorkspaceAuthErrors.${
                    workspaceAuth.status === 'unavailable'
                      ? 'unavailable'
                      : workspaceAuth.errorCode || 'authorization_failed'
                  }`)}
                </div>
              )}
            </div>
          ) : qrCode ? (
            <div className="space-y-4">
              <div className="space-y-1.5 text-sm leading-relaxed">
                <h3 className={labelClasses}>{t('dialog.howToConnect')}</h3>
                <p className="text-muted-foreground">
                  {isWhatsApp ? t('dialog.whatsappScanHint') : t('dialog.scanQR', { name: meta?.name })}
                </p>
              </div>
              <div className="mx-auto w-fit max-w-full rounded-lg border border-border p-3">
                {qrCode.startsWith('data:image') || qrCode.startsWith('http://') || qrCode.startsWith('https://') ? (
                  <img src={qrCode} alt={t('dialog.scanQR', { name: meta?.name })} className="aspect-square w-56 max-w-full object-contain rounded-2xl" />
                ) : (
                  <div className="flex aspect-square w-56 max-w-full items-center justify-center">
                    <QrCode className="h-32 w-32 text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>
          ) : loadingConfig ? (
            <div className="flex items-center justify-center py-10 rounded-2xl bg-transparent border border-black/10 dark:border-white/10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">{t('dialog.loadingConfig')}</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-1.5 text-sm leading-relaxed">
                <h3 className={labelClasses}>{t('dialog.howToConnect')}</h3>
                {setupHint ? (
                  <p className="text-muted-foreground">{setupHint}</p>
                ) : (
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    {meta?.instructions.map((instruction) => (
                      <li key={instruction}>{t(instruction)}</li>
                    ))}
                  </ol>
                )}
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

              {meta && meta.configFields.length > 0 && <div className="space-y-4">
                {meta.configFields.map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    value={configValues[field.key] || ''}
                    onChange={(value) => updateConfigValue(field.key, value)}
                    showSecret={showSecrets[field.key] || false}
                    onToggleSecret={() => toggleSecretVisibility(field.key)}
                    showEnvVar={!isFeishu}
                    error={isFeishu && showRequiredErrors && field.required && !configValues[field.key]?.trim()
                      ? t(field.key === 'appId' ? 'dialog.validationErrors.feishuAppIdRequired' : 'dialog.validationErrors.feishuAppSecretRequired')
                      : undefined}
                  />
                ))}
              </div>}

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
            </div>
          )}
        </div>
        {meta && (!loadingConfig || workspaceAuth || qrCode) && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            {!workspaceAuth && meta.docsUrl && (
              <Button variant="ghost" size="sm" className="mr-auto gap-1.5 px-2 text-muted-foreground" onClick={openDocs}>
                {t('dialog.viewDocs')}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
            {workspaceAuth ? (
              <>
                <Button variant="outline" size="sm" onClick={skipDingtalkWorkspaceAuth}>
                  {t('dialog.dingtalkWorkspaceAuthSkip')}
                </Button>
                {workspaceAuth.status === 'needs_auth' && (
                  <Button size="sm" data-testid="dingtalk-workspace-auth-start" onClick={() => void startDingtalkWorkspaceAuth()}>
                    {t('dialog.dingtalkWorkspaceAuthStart')}
                  </Button>
                )}
                {(workspaceAuth.status === 'error' || workspaceAuth.status === 'unavailable') && (
                  <Button size="sm" onClick={() => void startDingtalkWorkspaceAuth()}>
                    {t('dialog.dingtalkWorkspaceAuthRetry')}
                  </Button>
                )}
              </>
            ) : qrCode ? (
              <Button variant="outline" size="sm" onClick={() => {
                setQrCode(null);
                void handleConnect();
              }}>
                {t('dialog.refreshCode')}
              </Button>
            ) : (
              <>
                {shouldUseCredentialValidation && (
                  <Button variant="outline" size="sm" onClick={handleValidate} disabled={validating}>
                    {validating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('dialog.validating')}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        {t('dialog.validateConfig')}
                      </>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => void handleConnect()}
                  disabled={connecting || !isFormValid() || (showAccountIdEditor && !accountIdInput.trim())}
                >
                  {connecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {meta.connectionType === 'qr' ? t('dialog.generatingQR') : t('dialog.validatingAndSaving')}
                    </>
                  ) : meta.connectionType === 'qr' ? (
                    t('dialog.generateQRCode')
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      {isExistingConfig ? t('dialog.updateAndReconnect') : t('dialog.saveAndConnect')}
                    </>
                  )}
                </Button>
              </>
            )}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ConfigFieldProps {
  field: ChannelConfigField;
  value: string;
  onChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  showEnvVar: boolean;
  error?: string;
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

function ConfigField({ field, value, onChange, showSecret, onToggleSecret, showEnvVar, error }: ConfigFieldProps) {
  const { t } = useTranslation('channels');
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-2.5">
      <Label htmlFor={field.key} className={labelClasses}>
        {t(field.label)}
        {field.required && <span aria-hidden="true" className="text-destructive ml-1">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={field.key}
          type={isPassword && !showSecret ? 'password' : 'text'}
          placeholder={field.placeholder ? t(field.placeholder) : undefined}
          value={value}
          required={field.required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${field.key}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClasses, error && 'border-destructive/50 focus-visible:border-destructive')}
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSecret}
            aria-label={t(showSecret ? 'common:actions.hide' : 'common:actions.show')}
            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {error && <p id={`${field.key}-error`} className="text-xs text-destructive">{error}</p>}
      {field.description && (
        <p className="text-meta text-muted-foreground leading-relaxed">
          {t(field.description)}
        </p>
      )}
      {showEnvVar && field.envVar && (
        <p className="text-xs text-muted-foreground/70 font-mono">
          {t('dialog.envVar', { var: field.envVar })}
        </p>
      )}
    </div>
  );
}
