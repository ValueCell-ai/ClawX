/**
 * Cron Page
 * Manage scheduled tasks
 */
import { useEffect, useState, useCallback, type ReactNode, type SelectHTMLAttributes } from 'react';
import {
  Plus,
  Clock,
  Play,
  Trash2,
  RefreshCw,
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
  Timer,
  History,
  Pause,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { formatRelativeTime, cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CronJob, CronJobCreateInput, ScheduleType } from '@/types/cron';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// Common cron schedule presets
const schedulePresets: { key: string; value: string; type: ScheduleType }[] = [
  { key: 'everyMinute', value: '* * * * *', type: 'interval' },
  { key: 'every5Min', value: '*/5 * * * *', type: 'interval' },
  { key: 'every15Min', value: '*/15 * * * *', type: 'interval' },
  { key: 'everyHour', value: '0 * * * *', type: 'interval' },
  { key: 'daily9am', value: '0 9 * * *', type: 'daily' },
  { key: 'daily6pm', value: '0 18 * * *', type: 'daily' },
  { key: 'weeklyMon', value: '0 9 * * 1', type: 'weekly' },
  { key: 'monthly1st', value: '0 9 1 * *', type: 'monthly' },
];

// Parse cron schedule to human-readable format
// Handles both plain cron strings and Gateway CronSchedule objects:
//   { kind: "cron", expr: "...", tz?: "..." }
//   { kind: "every", everyMs: number }
//   { kind: "at", at: "..." }
function parseCronSchedule(schedule: unknown, t: TFunction<'cron'>): string {
  // Handle Gateway CronSchedule object format
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string; tz?: string; everyMs?: number; at?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') {
      return parseCronExpr(s.expr, t);
    }
    if (s.kind === 'every' && typeof s.everyMs === 'number') {
      const ms = s.everyMs;
      if (ms < 60_000) return t('schedule.everySeconds', { count: Math.round(ms / 1000) });
      if (ms < 3_600_000) return t('schedule.everyMinutes', { count: Math.round(ms / 60_000) });
      if (ms < 86_400_000) return t('schedule.everyHours', { count: Math.round(ms / 3_600_000) });
      return t('schedule.everyDays', { count: Math.round(ms / 86_400_000) });
    }
    if (s.kind === 'at' && typeof s.at === 'string') {
      try {
        return t('schedule.onceAt', { time: new Date(s.at).toLocaleString() });
      } catch {
        return t('schedule.onceAt', { time: s.at });
      }
    }
    return String(schedule);
  }

  // Handle plain cron string
  if (typeof schedule === 'string') {
    return parseCronExpr(schedule, t);
  }

  return String(schedule ?? t('schedule.unknown'));
}

// Parse a plain cron expression string to human-readable text
function parseCronExpr(cron: string, t: TFunction<'cron'>): string {
  const preset = schedulePresets.find((p) => p.value === cron);
  if (preset) return t(`presets.${preset.key}` as const);

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  if (minute === '*' && hour === '*') return t('presets.everyMinute');
  if (minute.startsWith('*/')) return t('schedule.everyMinutes', { count: Number(minute.slice(2)) });
  if (hour === '*' && minute === '0') return t('presets.everyHour');
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    return t('schedule.weeklyAt', { day: dayOfWeek, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (dayOfMonth !== '*') {
    return t('schedule.monthlyAtDay', { day: dayOfMonth, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (hour !== '*') {
    return t('schedule.dailyAt', { time: `${hour}:${minute.padStart(2, '0')}` });
  }

  return cron;
}

function estimateNextRun(scheduleExpr: string): string | null {
  const now = new Date();
  const next = new Date(now.getTime());

  if (scheduleExpr === '* * * * *') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/5 * * * *') {
    const delta = 5 - (next.getMinutes() % 5 || 5);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/15 * * * *') {
    const delta = 15 - (next.getMinutes() % 15 || 15);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * 1') {
    next.setSeconds(0, 0);
    next.setHours(9, 0, 0, 0);
    const day = next.getDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    next.setDate(next.getDate() + daysUntilMonday);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 1 * *') {
    next.setSeconds(0, 0);
    next.setDate(1);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleString();
  }

  return null;
}

interface DeliveryChannelAccount {
  accountId: string;
  name: string;
  isDefault: boolean;
}

interface DeliveryChannelGroup {
  channelType: string;
  defaultAccountId: string;
  accounts: DeliveryChannelAccount[];
}

interface ChannelTargetOption {
  value: string;
  label: string;
  kind: 'user' | 'group' | 'channel';
}

function isKnownChannelType(value: string): value is ChannelType {
  return value in CHANNEL_NAMES;
}

function getChannelDisplayName(value: string): string {
  return isKnownChannelType(value) ? CHANNEL_NAMES[value] : value;
}

function getDeliveryAccountDisplayName(account: DeliveryChannelAccount, t: TFunction): string {
  return account.accountId === 'default' && account.name === account.accountId
    ? t('channels:account.mainAccount')
    : account.name;
}

const TESTED_CRON_DELIVERY_CHANNELS = new Set<string>(['feishu', 'telegram', 'qqbot', 'wecom', 'wechat']);

function isSupportedCronDeliveryChannel(channelType: string): boolean {
  return TESTED_CRON_DELIVERY_CHANNELS.has(channelType);
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

function SelectField({ className, children, ...props }: SelectFieldProps) {
  return (
    <div className="relative">
      <Select
        className={cn(
          'h-[44px] rounded-xl border-black/10 dark:border-white/10 bg-background text-[13px] pr-10 [background-image:none] appearance-none',
          className,
        )}
        {...props}
      >
        {children}
      </Select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

// Create/Edit Task Dialog
interface TaskDialogProps {
  job?: CronJob;
  configuredChannels: DeliveryChannelGroup[];
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}

function TaskDialog({ job, configuredChannels, onClose, onSave }: TaskDialogProps) {
  const { t } = useTranslation('cron');
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(job?.name || '');
  const [message, setMessage] = useState(job?.message || '');
  // Extract cron expression string from CronSchedule object or use as-is if string
  const initialSchedule = (() => {
    const s = job?.schedule;
    if (!s) return '0 9 * * *';
    if (typeof s === 'string') return s;
    if (typeof s === 'object' && 'expr' in s && typeof (s as { expr: string }).expr === 'string') {
      return (s as { expr: string }).expr;
    }
    return '0 9 * * *';
  })();
  const [schedule, setSchedule] = useState(initialSchedule);
  const [customSchedule, setCustomSchedule] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [deliveryMode, setDeliveryMode] = useState<'none' | 'announce'>(job?.delivery?.mode === 'announce' ? 'announce' : 'none');
  const [deliveryChannel, setDeliveryChannel] = useState(job?.delivery?.channel || '');
  const [deliveryTarget, setDeliveryTarget] = useState(job?.delivery?.to || '');
  const [selectedDeliveryAccountId, setSelectedDeliveryAccountId] = useState(job?.delivery?.accountId || '');
  const [channelTargetOptions, setChannelTargetOptions] = useState<ChannelTargetOption[]>([]);
  const [loadingChannelTargets, setLoadingChannelTargets] = useState(false);
  const schedulePreview = estimateNextRun(useCustom ? customSchedule : schedule);
  const selectableChannels = configuredChannels.filter((group) => isSupportedCronDeliveryChannel(group.channelType));
  const availableChannels = selectableChannels.some((group) => group.channelType === deliveryChannel)
    ? selectableChannels
    : (
      deliveryChannel && isSupportedCronDeliveryChannel(deliveryChannel)
        ? [...selectableChannels, configuredChannels.find((group) => group.channelType === deliveryChannel) || { channelType: deliveryChannel, defaultAccountId: 'default', accounts: [] }]
        : selectableChannels
    );
  const effectiveDeliveryChannel = deliveryChannel
    || (deliveryMode === 'announce' ? (availableChannels[0]?.channelType || '') : '');
  const unsupportedDeliveryChannel = !!effectiveDeliveryChannel && !isSupportedCronDeliveryChannel(effectiveDeliveryChannel);
  const selectedChannel = availableChannels.find((group) => group.channelType === effectiveDeliveryChannel);
  const deliveryAccountOptions = (selectedChannel?.accounts ?? []).map((account) => ({
    accountId: account.accountId,
    displayName: getDeliveryAccountDisplayName(account, t),
  }));
  const hasCurrentDeliveryTarget = !!deliveryTarget;
  const currentDeliveryTargetOption = hasCurrentDeliveryTarget
    ? {
      value: deliveryTarget,
      label: `${t('dialog.currentTarget')} (${deliveryTarget})`,
      kind: 'user' as const,
    }
    : null;
  const effectiveDeliveryAccountId = selectedDeliveryAccountId
    || selectedChannel?.defaultAccountId
    || deliveryAccountOptions[0]?.accountId
    || '';
  const showsAccountSelector = (selectedChannel?.accounts.length ?? 0) > 0;
  const selectedResolvedAccountId = effectiveDeliveryAccountId || undefined;
  const availableTargetOptions = currentDeliveryTargetOption
    ? [currentDeliveryTargetOption, ...channelTargetOptions.filter((option) => option.value !== deliveryTarget)]
    : channelTargetOptions;

  useEffect(() => {
    if (deliveryMode !== 'announce') {
      setSelectedDeliveryAccountId('');
      return;
    }

    if (!selectedDeliveryAccountId && selectedChannel?.defaultAccountId) {
      setSelectedDeliveryAccountId(selectedChannel.defaultAccountId);
    }
  }, [deliveryMode, selectedChannel?.defaultAccountId, selectedDeliveryAccountId]);

  useEffect(() => {
    if (deliveryMode !== 'announce' || !effectiveDeliveryChannel || unsupportedDeliveryChannel) {
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
      return;
    }

    if (showsAccountSelector && !selectedResolvedAccountId) {
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
      return;
    }

    let cancelled = false;
    setLoadingChannelTargets(true);
    const params = new URLSearchParams({ channelType: effectiveDeliveryChannel });
    if (selectedResolvedAccountId) {
      params.set('accountId', selectedResolvedAccountId);
    }
    void hostApiFetch<{ success: boolean; targets?: ChannelTargetOption[]; error?: string }>(
      `/api/channels/targets?${params.toString()}`,
    ).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        throw new Error(result.error || 'Failed to load channel targets');
      }
      setChannelTargetOptions(result.targets || []);
    }).catch((error) => {
      if (!cancelled) {
        console.warn('Failed to load channel targets:', error);
        setChannelTargetOptions([]);
      }
    }).finally(() => {
      if (!cancelled) {
        setLoadingChannelTargets(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [deliveryMode, effectiveDeliveryChannel, selectedResolvedAccountId, showsAccountSelector, unsupportedDeliveryChannel]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    if (!message.trim()) {
      toast.error(t('toast.messageRequired'));
      return;
    }

    const finalSchedule = useCustom ? customSchedule : schedule;
    if (!finalSchedule.trim()) {
      toast.error(t('toast.scheduleRequired'));
      return;
    }

    setSaving(true);
    try {
      const finalDelivery = deliveryMode === 'announce'
        ? {
          mode: 'announce' as const,
          channel: effectiveDeliveryChannel.trim(),
          ...(selectedResolvedAccountId
            ? { accountId: effectiveDeliveryAccountId }
            : {}),
          to: deliveryTarget.trim(),
        }
        : { mode: 'none' as const };

      if (finalDelivery.mode === 'announce') {
        if (!finalDelivery.channel) {
          toast.error(t('toast.channelRequired'));
          return;
        }
        if (!isSupportedCronDeliveryChannel(finalDelivery.channel)) {
          toast.error(t('toast.deliveryChannelUnsupported', { channel: getChannelDisplayName(finalDelivery.channel) }));
          return;
        }
        if (!finalDelivery.to) {
          toast.error(t('toast.deliveryTargetRequired'));
          return;
        }
      }

      await onSave({
        name: name.trim(),
        message: message.trim(),
        schedule: finalSchedule,
        delivery: finalDelivery,
        enabled,
      });
      onClose();
      toast.success(job ? t('toast.updated') : t('toast.created'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-[#f3f1e9] dark:bg-card overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal">{job ? t('dialog.editTitle') : t('dialog.createTitle')}</CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">{t('dialog.description')}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          {/* Name */}
          <div className="space-y-2.5">
            <Label htmlFor="name" className="text-[14px] text-foreground/80 font-bold">{t('dialog.taskName')}</Label>
            <Input
              id="name"
              placeholder={t('dialog.taskNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-[44px] rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
            />
          </div>

          {/* Message */}
          <div className="space-y-2.5">
            <Label htmlFor="message" className="text-[14px] text-foreground/80 font-bold">{t('dialog.message')}</Label>
            <Textarea
              id="message"
              placeholder={t('dialog.messagePlaceholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40 resize-none"
            />
          </div>

          {/* Schedule */}
          <div className="space-y-2.5">
            <Label className="text-[14px] text-foreground/80 font-bold">{t('dialog.schedule')}</Label>
            {!useCustom ? (
              <div className="grid grid-cols-2 gap-2">
                {schedulePresets.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={schedule === preset.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSchedule(preset.value)}
                    className={cn(
                      "justify-start h-10 rounded-xl font-medium text-[13px] transition-all",
                      schedule === preset.value
                        ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm border-transparent"
                        : "bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground"
                    )}
                  >
                    <Timer className="h-4 w-4 mr-2 opacity-70" />
                    {t(`presets.${preset.key}` as const)}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                placeholder={t('dialog.cronPlaceholder')}
                value={customSchedule}
                onChange={(e) => setCustomSchedule(e.target.value)}
                className="h-[44px] rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
              />
            )}
            <div className="flex items-center justify-between mt-2">
              <p className="text-[12px] text-muted-foreground/80 font-medium">
                {schedulePreview ? `${t('card.next')}: ${schedulePreview}` : t('dialog.cronPlaceholder')}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUseCustom(!useCustom)}
                className="text-[12px] h-7 px-2 text-foreground/60 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-lg"
              >
                {useCustom ? t('dialog.usePresets') : t('dialog.useCustomCron')}
              </Button>
            </div>
          </div>

          {/* Delivery */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[14px] text-foreground/80 font-bold">{t('dialog.deliveryTitle')}</Label>
              <p className="text-[12px] text-muted-foreground">{t('dialog.deliveryDescription')}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={deliveryMode === 'none' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDeliveryMode('none')}
                className={cn(
                  'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                  deliveryMode === 'none'
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                    : 'bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                )}
              >
                <div>
                  <div className="text-[13px] font-semibold">{t('dialog.deliveryModeNone')}</div>
                  <div className="text-[11px] opacity-80">{t('dialog.deliveryModeNoneDesc')}</div>
                </div>
              </Button>
              <Button
                type="button"
                variant={deliveryMode === 'announce' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDeliveryMode('announce')}
                className={cn(
                  'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                  deliveryMode === 'announce'
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                    : 'bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                )}
              >
                <div>
                  <div className="text-[13px] font-semibold">{t('dialog.deliveryModeAnnounce')}</div>
                  <div className="text-[11px] opacity-80">{t('dialog.deliveryModeAnnounceDesc')}</div>
                </div>
              </Button>
            </div>

            {deliveryMode === 'announce' && (
              <div className="space-y-3 rounded-2xl border border-black/5 dark:border-white/5 bg-[#eeece3] dark:bg-muted p-4 shadow-sm">
                <div className="space-y-2">
                  <Label htmlFor="delivery-channel" className="text-[13px] text-foreground/80 font-bold">
                    {t('dialog.deliveryChannel')}
                  </Label>
                  <SelectField
                    id="delivery-channel"
                    value={effectiveDeliveryChannel}
                    onChange={(event) => {
                      setDeliveryChannel(event.target.value);
                      setSelectedDeliveryAccountId('');
                      setDeliveryTarget('');
                    }}
                  >
                    <option value="">{t('dialog.selectChannel')}</option>
                    {availableChannels.map((group) => (
                      <option key={group.channelType} value={group.channelType}>
                        {!isSupportedCronDeliveryChannel(group.channelType)
                          ? `${getChannelDisplayName(group.channelType)} (${t('dialog.channelUnsupportedTag')})`
                          : getChannelDisplayName(group.channelType)}
                      </option>
                    ))}
                  </SelectField>
                  {availableChannels.length === 0 && (
                    <p className="text-[12px] text-muted-foreground">{t('dialog.noChannels')}</p>
                  )}
                  {unsupportedDeliveryChannel && (
                    <p className="text-[12px] text-destructive">{t('dialog.deliveryChannelUnsupported', { channel: getChannelDisplayName(effectiveDeliveryChannel) })}</p>
                  )}
                  {selectedChannel && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('dialog.deliveryDefaultAccountHint', { account: selectedChannel.defaultAccountId })}
                    </p>
                  )}
                </div>

                {showsAccountSelector && (
                  <div className="space-y-2">
                    <Label htmlFor="delivery-account" className="text-[13px] text-foreground/80 font-bold">
                      {t('dialog.deliveryAccount')}
                    </Label>
                    <SelectField
                      id="delivery-account"
                      value={effectiveDeliveryAccountId}
                      onChange={(event) => {
                        setSelectedDeliveryAccountId(event.target.value);
                        setDeliveryTarget('');
                      }}
                      disabled={deliveryAccountOptions.length === 0}
                    >
                      <option value="">
                        {t('dialog.selectDeliveryAccount')}
                      </option>
                      {deliveryAccountOptions.map((option) => (
                        <option key={option.accountId} value={option.accountId}>
                          {option.displayName}
                        </option>
                      ))}
                    </SelectField>
                    <p className="text-[12px] text-muted-foreground">{t('dialog.deliveryAccountDesc')}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="delivery-target-select" className="text-[13px] text-foreground/80 font-bold">
                    {t('dialog.deliveryTarget')}
                  </Label>
                  <SelectField
                    id="delivery-target-select"
                    value={deliveryTarget}
                    onChange={(event) => setDeliveryTarget(event.target.value)}
                    disabled={loadingChannelTargets || availableTargetOptions.length === 0}
                  >
                    <option value="">{loadingChannelTargets ? t('dialog.loadingTargets') : t('dialog.selectDeliveryTarget')}</option>
                    {availableTargetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectField>
                  <p className="text-[12px] text-muted-foreground">
                    {availableTargetOptions.length > 0
                      ? t('dialog.deliveryTargetDescAuto')
                      : t('dialog.noDeliveryTargets', { channel: getChannelDisplayName(effectiveDeliveryChannel) })}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between bg-[#eeece3] dark:bg-muted p-4 rounded-2xl shadow-sm border border-black/5 dark:border-white/5">
            <div>
              <Label className="text-[14px] text-foreground/80 font-bold">{t('dialog.enableImmediately')}</Label>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {t('dialog.enableImmediatelyDesc')}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={onClose} className="rounded-full px-6 h-[42px] text-[13px] font-semibold border-black/20 dark:border-white/20 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground shadow-sm">
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={saving} className="rounded-full px-6 h-[42px] text-[13px] font-semibold shadow-sm border border-transparent transition-all">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('common:status.saving', 'Saving...')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {job ? t('dialog.saveChanges') : t('dialog.createTitle')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Job Card Component
interface CronJobCardProps {
  job: CronJob;
  deliveryAccountName?: string;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
}

function CronJobCard({ job, deliveryAccountName, onToggle, onEdit, onDelete, onTrigger }: CronJobCardProps) {
  const { t } = useTranslation('cron');
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger();
      toast.success(t('toast.triggered'));
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const deliveryChannel = typeof job.delivery?.channel === 'string' ? job.delivery.channel : '';
  const deliveryLabel = deliveryChannel ? getChannelDisplayName(deliveryChannel) : '';
  const deliveryIcon = deliveryChannel && isKnownChannelType(deliveryChannel)
    ? CHANNEL_ICONS[deliveryChannel]
    : null;

  return (
    <div
      className="group flex flex-col p-5 rounded-2xl bg-transparent border border-transparent hover:bg-black/5 dark:hover:bg-white/5 transition-all relative overflow-hidden cursor-pointer"
      onClick={onEdit}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm group-hover:scale-105 transition-transform">
            <Clock className={cn("h-5 w-5", job.enabled ? "text-foreground" : "text-muted-foreground")} />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-[16px] font-semibold text-foreground truncate">{job.name}</h3>
              <div
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  job.enabled ? "bg-green-500" : "bg-muted-foreground"
                )}
                title={job.enabled ? t('stats.active') : t('stats.paused')}
              />
            </div>
            <p className="text-[13px] text-muted-foreground flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" />
              {parseCronSchedule(job.schedule, t)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <Switch
            checked={job.enabled}
            onCheckedChange={onToggle}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-end mt-2 pl-[62px]">
        <div className="flex items-start gap-2 mb-3">
          <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
            {job.message}
          </p>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground/80 font-medium mb-3">
          {job.delivery?.mode === 'announce' && deliveryChannel && (
            <span className="flex items-center gap-1.5">
              {deliveryIcon}
              <span>{deliveryLabel}</span>
              {deliveryAccountName ? (
                <span className="max-w-[220px] truncate">{deliveryAccountName}</span>
              ) : job.delivery.to && (
                <span className="max-w-[220px] truncate">{job.delivery.to}</span>
              )}
            </span>
          )}

          {job.lastRun && (
            <span className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              {t('card.last')}: {formatRelativeTime(job.lastRun.time)}
              {job.lastRun.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
            </span>
          )}

          {job.nextRun && job.enabled && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {t('card.next')}: {new Date(job.nextRun).toLocaleString()}
            </span>
          )}
        </div>

        {/* Last Run Error */}
        {job.lastRun && !job.lastRun.success && job.lastRun.error && (
          <div className="flex items-start gap-2 p-2.5 mb-3 rounded-xl bg-destructive/10 border border-destructive/20 text-[13px] text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{job.lastRun.error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity mt-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTrigger}
            disabled={triggering}
            className="h-8 px-3 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-[13px] font-medium transition-colors"
          >
            {triggering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            {t('card.runNow')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-8 px-3 text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded-lg text-[13px] font-medium transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {t('common:actions.delete', 'Delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Cron() {
  const { t } = useTranslation('cron');
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();
  const [jobToDelete, setJobToDelete] = useState<{ id: string } | null>(null);
  const [configuredChannels, setConfiguredChannels] = useState<DeliveryChannelGroup[]>([]);

  const isGatewayRunning = gatewayStatus.state === 'running';

  const fetchConfiguredChannels = useCallback(async () => {
    try {
      const response = await hostApiFetch<{ success: boolean; channels?: DeliveryChannelGroup[]; error?: string }>(
        '/api/channels/accounts',
      );
      if (!response.success) {
        throw new Error(response.error || 'Failed to load delivery channels');
      }
      setConfiguredChannels(response.channels || []);
    } catch (fetchError) {
      console.warn('Failed to load delivery channels:', fetchError);
      setConfiguredChannels([]);
    }
  }, []);

  // Fetch jobs on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchJobs();
    }
  }, [fetchJobs, isGatewayRunning]);

  useEffect(() => {
    void fetchConfiguredChannels();
  }, [fetchConfiguredChannels]);

  // Statistics
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const activeJobs = safeJobs.filter((j) => j.enabled);
  const pausedJobs = safeJobs.filter((j) => !j.enabled);
  const failedJobs = safeJobs.filter((j) => j.lastRun && !j.lastRun.success);

  const handleSave = useCallback(async (input: CronJobCreateInput) => {
    if (editingJob) {
      await updateJob(editingJob.id, input);
    } else {
      await createJob(input);
    }
  }, [editingJob, createJob, updateJob]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await toggleJob(id, enabled);
      toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
    } catch {
      toast.error(t('toast.failedUpdate'));
    }
  }, [toggleJob, t]);



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
              {t('title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={() => {
                void fetchJobs();
                void fetchConfiguredChannels();
              }}
              disabled={!isGatewayRunning}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
            <Button
              onClick={() => {
                setEditingJob(undefined);
                setShowDialog(true);
              }}
              disabled={!isGatewayRunning}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('newTask')}
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {/* Gateway Warning */}
          {!isGatewayRunning && (
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

          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-[40px] leading-none font-serif text-foreground">{safeJobs.length}</p>
                <p className="text-[14px] font-medium text-muted-foreground">{t('stats.total')}</p>
              </div>
            </div>

            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Play className="h-5 w-5 text-green-600 dark:text-green-500 ml-0.5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-[40px] leading-none font-serif text-foreground">{activeJobs.length}</p>
                <p className="text-[14px] font-medium text-muted-foreground">{t('stats.active')}</p>
              </div>
            </div>

            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <Pause className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-[40px] leading-none font-serif text-foreground">{pausedJobs.length}</p>
                <p className="text-[14px] font-medium text-muted-foreground">{t('stats.paused')}</p>
              </div>
            </div>

            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-[40px] leading-none font-serif text-foreground">{failedJobs.length}</p>
                <p className="text-[14px] font-medium text-muted-foreground">{t('stats.failed')}</p>
              </div>
            </div>
          </div>

          {/* Jobs List */}
          {safeJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
              <Clock className="h-10 w-10 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2 text-foreground">{t('empty.title')}</h3>
              <p className="text-[14px] text-center mb-6 max-w-md">
                {t('empty.description')}
              </p>
              <Button
                onClick={() => {
                  setEditingJob(undefined);
                  setShowDialog(true);
                }}
                disabled={!isGatewayRunning}
                className="rounded-full px-6 h-10"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('empty.create')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {safeJobs.map((job) => {
                const channelGroup = configuredChannels.find((group) => group.channelType === job.delivery?.channel);
                const account = channelGroup?.accounts.find((item) => item.accountId === job.delivery?.accountId);
                const deliveryAccountName = account ? getDeliveryAccountDisplayName(account, t) : undefined;
                return (
                <CronJobCard
                  key={job.id}
                  job={job}
                  deliveryAccountName={deliveryAccountName}
                  onToggle={(enabled) => handleToggle(job.id, enabled)}
                  onEdit={() => {
                    setEditingJob(job);
                    setShowDialog(true);
                  }}
                  onDelete={() => setJobToDelete({ id: job.id })}
                  onTrigger={() => triggerJob(job.id)}
                />
                );
              })}
            </div>
          )}

        </div>
      </div>

      {/* Create/Edit Dialog */}
      {showDialog && (
        <TaskDialog
          job={editingJob}
          configuredChannels={configuredChannels}
          onClose={() => {
            setShowDialog(false);
            setEditingJob(undefined);
          }}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={!!jobToDelete}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (jobToDelete) {
            await deleteJob(jobToDelete.id);
            setJobToDelete(null);
            toast.success(t('toast.deleted'));
          }
        }}
        onCancel={() => setJobToDelete(null)}
      />
    </div>
  );
}

export default Cron;
