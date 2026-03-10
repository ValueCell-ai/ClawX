/**
 * Channels Page
 * Manage messaging channel connections with configuration UI
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Trash2,
  QrCode,
  Loader2,
  X,
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
  type Channel,
  type ChannelMeta,
  type ChannelConfigField,
} from '@/types/channel';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';

export function Channels() {
  const { t } = useTranslation('channels');
  const { channels, loading, error, fetchChannels, deleteChannel } = useChannelsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [configuredTypes, setConfiguredTypes] = useState<string[]>([]);
  const [channelToDelete, setChannelToDelete] = useState<{ id: string } | null>(null);

  // Fetch channels on mount
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Fetch configured channel types from config file
  const fetchConfiguredTypes = useCallback(async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        channels?: string[];
      }>('/api/channels/configured');
      if (result.success && result.channels) {
        setConfiguredTypes(result.channels);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchConfiguredTypes();
  }, [fetchConfiguredTypes]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      fetchChannels();
      fetchConfiguredTypes();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannels, fetchConfiguredTypes]);

  // Get channel types to display
  const displayedChannelTypes = getPrimaryChannels();

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('title', 'Messaging Channels')}
            </h1>
            <p className="text-[17px] text-foreground/80 font-medium">
              {t('subtitle', 'Manage your messaging channels and connections')}
            </p>
          </div>
          
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={fetchChannels}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          
          {/* Gateway Warning */}
          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          {/* Available Channels (Configured) */}
          {channels.length > 0 && (
            <div className="mb-12">
              <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
                Available Channels
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                {channels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    onDelete={() => setChannelToDelete({ id: channel.id })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Supported Channels (Not yet configured) */}
          <div className="mb-8">
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              Supported Channels
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {displayedChannelTypes.map((type) => {
                const meta = CHANNEL_META[type];
                const isConfigured = channels.some(c => c.type === type) || configuredTypes.includes(type);
                
                // Hide already configured channels from "Supported Channels" section
                if (isConfigured) return null;
                
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedChannelType(type);
                      setShowAddDialog(true);
                    }}
                    className={cn(
                      "group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5"
                    )}
                  >
                    <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm mb-3">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[16px] font-semibold text-foreground truncate">{meta.name}</h3>
                        {meta.isPlugin && (
                          <Badge variant="secondary" className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                            {t('pluginBadge', 'Plugin')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                        {t(meta.description.replace('channels:', ''))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          
        </div>
      </div>

      {/* Add Channel Dialog */}
      {showAddDialog && (
        <AddChannelDialog
          selectedType={selectedChannelType}
          onSelectType={setSelectedChannelType}
          onClose={() => {
            setShowAddDialog(false);
            setSelectedChannelType(null);
          }}
          onChannelAdded={() => {
            fetchChannels();
            fetchConfiguredTypes();
            setShowAddDialog(false);
            setSelectedChannelType(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!channelToDelete}
        title={t('common.confirm', 'Confirm')}
        message={t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (channelToDelete) {
            await deleteChannel(channelToDelete.id);
            // Immediately update configuredTypes state so it disappears from available and appears in supported
            const channelType = channelToDelete.id.split('-')[0];
            setConfiguredTypes((prev) => prev.filter((type) => type !== channelType));
            setChannelToDelete(null);
          }
        }}
        onCancel={() => setChannelToDelete(null)}
      />
    </div>
  );
}

// ==================== Channel Logo Component ====================
function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

// ==================== Channel Card Component ====================

interface ChannelCardProps {
  channel: Channel;
  onDelete: () => void;
}

function ChannelCard({ channel, onDelete }: ChannelCardProps) {
  const { t } = useTranslation('channels');
  const meta = CHANNEL_META[channel.type];

  return (
    <div className="group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5">
      <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm mb-3">
        <ChannelLogo type={channel.type} />
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[16px] font-semibold text-foreground truncate">{channel.name}</h3>
            {meta?.isPlugin && (
              <Badge variant="secondary" className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                {t('pluginBadge', 'Plugin')}
              </Badge>
            )}
            <div 
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
                channel.status === 'connected' ? "bg-green-500" :
                channel.status === 'connecting' ? "bg-yellow-500 animate-pulse" :
                channel.status === 'error' ? "bg-destructive" :
                "bg-muted-foreground"
              )} 
              title={channel.status}
            />
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0 -mr-2"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        
        {channel.error ? (
          <p className="text-[13.5px] text-destructive line-clamp-2 leading-[1.5]">
            {channel.error}
          </p>
        ) : (
          <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
            {meta ? t(meta.description.replace('channels:', '')) : CHANNEL_NAMES[channel.type]}
          </p>
        )}
      </div>
    </div>
  );
}

// ==================== Add Channel Dialog ====================

interface AddChannelDialogProps {
  selectedType: ChannelType | null;
  onSelectType: (type: ChannelType | null) => void;
  onClose: () => void;
  onChannelAdded: () => void;
}

function AddChannelDialog({ selectedType, onSelectType, onClose, onChannelAdded }: AddChannelDialogProps) {
  const { t } = useTranslation('channels');
  const { addChannel } = useChannelsStore();
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [channelName, setChannelName] = useState('');
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

  // Load existing config when a channel type is selected
  useEffect(() => {
    if (!selectedType) {
      setConfigValues({});
      setChannelName('');
      setIsExistingConfig(false);
      setChannelName('');
      setIsExistingConfig(false);
      // Ensure we clean up any pending QR session if switching away
      hostApiFetch('/api/channels/whatsapp/cancel', { method: 'POST' }).catch(() => { });
      return;
    }

    let cancelled = false;
    setLoadingConfig(true);

    (async () => {
      try {
        const result = await invokeIpc(
          'channel:getFormValues',
          selectedType
        ) as { success: boolean; values?: Record<string, string> };

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

    return () => { cancelled = true; };
  }, [selectedType]);

  // Focus first input when form is ready (avoids Windows focus loss after native dialogs)
  useEffect(() => {
    if (selectedType && !loadingConfig && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [selectedType, loadingConfig]);

  // Listen for WhatsApp QR events
  useEffect(() => {
    if (selectedType !== 'whatsapp') return;

    const onQr = (...args: unknown[]) => {
      const data = args[0] as { qr: string; raw: string };
      setQrCode(`data:image/png;base64,${data.qr}`);
    };

    const onSuccess = async (...args: unknown[]) => {
      const data = args[0] as { accountId?: string } | undefined;
      toast.success(t('toast.whatsappConnected'));
      const accountId = data?.accountId || channelName.trim() || 'default';
      try {
        const saveResult = await hostApiFetch<{ success?: boolean; error?: string }>('/api/channels/config', {
          method: 'POST',
          body: JSON.stringify({ channelType: 'whatsapp', config: { enabled: true } }),
        });
        if (!saveResult?.success) {
          console.error('Failed to save WhatsApp config:', saveResult?.error);
        } else {
          console.info('Saved WhatsApp config for account:', accountId);
        }
      } catch (error) {
        console.error('Failed to save WhatsApp config:', error);
      }
      // Register the channel locally so it shows up immediately
      addChannel({
        type: 'whatsapp',
        name: channelName || 'WhatsApp',
      }).then(() => {
        // Restart gateway to pick up the new session
        useGatewayStore.getState().restart().catch(console.error);
        onChannelAdded();
      });
    };

    const onError = (...args: unknown[]) => {
      const err = args[0] as string;
      console.error('WhatsApp Login Error:', err);
      toast.error(t('toast.whatsappFailed', { error: err }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent('channel:whatsapp-qr', onQr);
    const removeSuccessListener = subscribeHostEvent('channel:whatsapp-success', onSuccess);
    const removeErrorListener = subscribeHostEvent('channel:whatsapp-error', onError);

    return () => {
      if (typeof removeQrListener === 'function') removeQrListener();
      if (typeof removeSuccessListener === 'function') removeSuccessListener();
      if (typeof removeErrorListener === 'function') removeErrorListener();
      // Cancel when unmounting or switching types
      hostApiFetch('/api/channels/whatsapp/cancel', { method: 'POST' }).catch(() => { });
    };
  }, [selectedType, addChannel, channelName, onChannelAdded, t]);

  const handleValidate = async () => {
    if (!selectedType) return;

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
      // For QR-based channels, request QR code
      if (meta.connectionType === 'qr') {
        const accountId = channelName.trim() || 'default';
        await hostApiFetch('/api/channels/whatsapp/start', {
          method: 'POST',
          body: JSON.stringify({ accountId }),
        });
        // The QR code will be set via event listener
        return;
      }

      // Step 1: Validate credentials against the actual service API
      if (meta.connectionType === 'token') {
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

        // Show success details (bot name, guild name, etc.) as warnings/info
        const warnings = validationResponse.warnings || [];
        if (validationResponse.details) {
          const details = validationResponse.details;
          if (details.botUsername) {
            warnings.push(`Bot: @${details.botUsername}`);
          }
          if (details.guildName) {
            warnings.push(`Server: ${details.guildName}`);
          }
          if (details.channelName) {
            warnings.push(`Channel: #${details.channelName}`);
          }
        }

        // Show validation success with details
        setValidationResult({
          valid: true,
          errors: [],
          warnings,
        });
      }

      // Step 2: Save channel configuration via IPC
      const config: Record<string, unknown> = { ...configValues };
      const saveResult = await hostApiFetch<{
        success?: boolean;
        error?: string;
        warning?: string;
        pluginInstalled?: boolean;
      }>('/api/channels/config', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config }),
      });
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save channel config');
      }
      if (typeof saveResult.warning === 'string' && saveResult.warning) {
        toast.warning(saveResult.warning);
      }

      // Step 3: Add a local channel entry for the UI
      await addChannel({
        type: selectedType,
        name: channelName || CHANNEL_NAMES[selectedType],
        token: configValues[meta.configFields[0]?.key] || undefined,
      });

      toast.success(t('toast.channelSaved', { name: meta.name }));

      // Gateway restart is now handled server-side via debouncedRestart()
      // inside the channel:saveConfig IPC handler, so we don't need to
      // trigger it explicitly here.  This avoids cascading restarts when
      // multiple config changes happen in quick succession (e.g. during
      // the setup wizard).
      toast.success(t('toast.channelConnecting', { name: meta.name }));

      // Brief delay so user can see the success state before dialog closes
      await new Promise((resolve) => setTimeout(resolve, 800));
      onChannelAdded();
    } catch (error) {
      toast.error(t('toast.configFailed', { error }));
      setConnecting(false);
    }
  };

  const openDocs = () => {
    if (meta?.docsUrl) {
      const url = t(meta.docsUrl.replace('channels:', ''));
      try {
        if (window.electron?.openExternal) {
          window.electron.openExternal(url);
        } else {
          // Fallback: open in new window
          window.open(url, '_blank');
        }
      } catch (error) {
        console.error('Failed to open docs:', error);
        // Fallback: open in new window
        window.open(url, '_blank');
      }
    }
  };


  const isFormValid = () => {
    if (!meta) return false;

    // Check all required fields are filled
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-[#f3f1e9] dark:bg-[#1a1a19] overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal">
              {selectedType
                ? isExistingConfig
                  ? t('dialog.updateTitle', { name: CHANNEL_NAMES[selectedType] })
                  : t('dialog.configureTitle', { name: CHANNEL_NAMES[selectedType] })
                : t('dialog.addTitle')}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {selectedType && isExistingConfig
                ? t('dialog.existingDesc')
                : meta ? t(meta.description.replace('channels:', '')) : t('dialog.selectDesc')}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            // Channel type selection
            <div className="grid grid-cols-2 gap-4">
              {getPrimaryChannels().map((type) => {
                const channelMeta = CHANNEL_META[type];
                return (
                  <button
                    key={type}
                    onClick={() => onSelectType(type)}
                    className="p-4 rounded-2xl border border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-all text-left group"
                  >
                    <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm mb-3 group-hover:scale-105 transition-transform">
                      <ChannelLogo type={type} />
                    </div>
                    <p className="font-semibold text-[15px]">{channelMeta.name}</p>
                    <p className="text-[13px] text-muted-foreground mt-0.5">
                      {channelMeta.connectionType === 'qr' ? t('dialog.qrCode') : t('dialog.token')}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : qrCode ? (
            // QR Code display
            <div className="text-center space-y-5 py-4">
              <div className="bg-white p-5 rounded-3xl inline-block shadow-sm border border-black/5">
                {qrCode.startsWith('data:image') ? (
                  <img src={qrCode} alt="Scan QR Code" className="w-64 h-64 object-contain" />
                ) : (
                  <div className="w-64 h-64 bg-gray-50 rounded-2xl flex items-center justify-center">
                    <QrCode className="h-24 w-24 text-gray-300" />
                  </div>
                )}
              </div>
              <p className="text-[14px] text-muted-foreground font-medium">
                {t('dialog.scanQR', { name: meta?.name })}
              </p>
              <div className="flex justify-center gap-2 pt-2">
                <Button variant="outline" onClick={() => {
                  setQrCode(null);
                  handleConnect(); // Retry
                }} className="rounded-full px-6 h-[42px] text-[13px] font-semibold border-black/20 dark:border-white/20 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground shadow-sm">
                  {t('dialog.refreshCode')}
                </Button>
              </div>
            </div>
          ) : loadingConfig ? (
            // Loading saved config
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
              <span className="text-[14px] font-medium text-muted-foreground">{t('dialog.loadingConfig')}</span>
            </div>
          ) : (
            // Connection form
            <div className="space-y-4">
              {/* Existing config hint */}
              {isExistingConfig && (
                <div className="bg-[#eeece3] dark:bg-[#151514] text-foreground/80 font-medium p-4 rounded-2xl text-[13.5px] flex items-center gap-2.5 shadow-sm border border-black/5 dark:border-white/5">
                  <CheckCircle className="h-4 w-4 shrink-0 text-blue-500" />
                  <span>{t('dialog.existingHint')}</span>
                </div>
              )}

              {/* Instructions */}
              <div className="bg-[#eeece3] dark:bg-[#151514] p-5 rounded-2xl space-y-3 shadow-sm border border-black/5 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[14px] text-foreground/80">{t('dialog.howToConnect')}</p>
                  <Button
                    variant="link"
                    className="p-0 h-auto text-[13px] text-muted-foreground hover:text-foreground"
                    onClick={openDocs}
                  >
                    <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                    {t('dialog.viewDocs')}
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>
                <ol className="list-decimal list-inside text-[13.5px] text-muted-foreground space-y-1.5 leading-relaxed">
                  {meta?.instructions.map((instruction, i) => (
                    <li key={i}>{t(instruction.replace('channels:', ''))}</li>
                  ))}
                </ol>
              </div>

              {/* Channel name */}
              <div className="space-y-2.5">
                <Label htmlFor="name" className="text-[14px] text-foreground/80 font-bold">{t('dialog.channelName')}</Label>
                <Input
                  ref={firstInputRef}
                  id="name"
                  placeholder={t('dialog.channelNamePlaceholder', { name: meta?.name })}
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  className="h-[44px] rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-[#151514] border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                />
              </div>

              {/* Configuration fields */}
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

              {/* Validation Results */}
              {validationResult && (
                <div className={`p-4 rounded-2xl text-[13.5px] shadow-sm border border-black/5 dark:border-white/5 ${validationResult.valid ? 'bg-[#eeece3] dark:bg-[#151514] text-foreground/80' : 'bg-destructive/10 text-destructive'
                  }`}>
                  <div className="flex items-start gap-2.5">
                    {validationResult.valid ? (
                      <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h4 className="font-bold mb-1">
                        {validationResult.valid ? t('dialog.credentialsVerified') : t('dialog.validationFailed')}
                      </h4>
                      {validationResult.errors.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5 font-medium">
                          {validationResult.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      )}
                      {validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-1 text-green-600 dark:text-green-500 space-y-0.5 font-medium">
                          {validationResult.warnings.map((info, i) => (
                            <p key={i} className="text-[13px]">{info}</p>
                          ))}
                        </div>
                      )}
                      {!validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-2 text-yellow-600 dark:text-yellow-500 font-medium">
                          <p className="font-bold text-[12px] uppercase mb-1">{t('dialog.warnings')}</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {validationResult.warnings.map((warn, i) => (
                              <li key={i}>{warn}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex justify-end pt-4">
                <div className="flex gap-3">
                  {/* Validation Button - Only for token-based channels for now */}
                  {meta?.connectionType === 'token' && (
                    <Button
                      variant="secondary"
                      onClick={handleValidate}
                      disabled={validating}
                      className="rounded-full px-6 h-[42px] text-[13px] font-semibold bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-foreground shadow-sm"
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
                    onClick={handleConnect}
                    disabled={connecting || !isFormValid()}
                    className="rounded-full px-6 h-[42px] text-[13px] font-semibold bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm border border-transparent transition-all"
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
    </div >
  );
}

// ==================== Config Field Component ====================

interface ConfigFieldProps {
  field: ChannelConfigField;
  value: string;
  onChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
}

function ConfigField({ field, value, onChange, showSecret, onToggleSecret }: ConfigFieldProps) {
  const { t } = useTranslation('channels');
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-2.5">
      <Label htmlFor={field.key} className="text-[14px] text-foreground/80 font-bold">
        {t(field.label.replace('channels:', ''))}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={field.key}
          type={isPassword && !showSecret ? 'password' : 'text'}
          placeholder={field.placeholder ? t(field.placeholder.replace('channels:', '')) : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-[44px] rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-[#151514] border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSecret}
            className="h-[44px] w-[44px] rounded-xl bg-[#eeece3] dark:bg-[#151514] border-black/10 dark:border-white/10 text-muted-foreground hover:text-foreground shrink-0 shadow-sm"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {field.description && (
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {t(field.description.replace('channels:', ''))}
        </p>
      )}
      {field.envVar && (
        <p className="text-[12px] text-muted-foreground/70 font-mono">
          {t('dialog.envVar', { var: field.envVar })}
        </p>
      )}
    </div>
  );
}

export default Channels;
