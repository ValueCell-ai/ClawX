/**
 * Chat Toolbar
 * Session model selector, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { useEffect, type ChangeEvent } from 'react';
import { RefreshCw, Brain, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toUserMessage } from '@/lib/api-client';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const DEFAULT_MODEL_VALUE = '__agent_default__';

function buildModelValue(provider?: string, model?: string): string {
  if (!provider || !model) return DEFAULT_MODEL_VALUE;
  return `${provider}/${model}`;
}

function formatModelOptionLabel(name: string, provider: string): string {
  return `${name} · ${provider}`;
}

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentSession = useChatStore((s) => s.sessions.find((session) => session.key === currentSessionKey));
  const sessionModelOptions = useChatStore((s) => s.sessionModelOptions);
  const sessionModelLoading = useChatStore((s) => s.sessionModelLoading);
  const sessionModelSaving = useChatStore((s) => s.sessionModelSaving);
  const loadSessionModelOptions = useChatStore((s) => s.loadSessionModelOptions);
  const updateCurrentSessionModel = useChatStore((s) => s.updateCurrentSessionModel);
  const { t } = useTranslation('chat');

  useEffect(() => {
    void loadSessionModelOptions();
  }, [loadSessionModelOptions]);

  const currentModelValue = buildModelValue(currentSession?.modelProvider, currentSession?.model);
  const hasCurrentModelOption = currentModelValue === DEFAULT_MODEL_VALUE
    || sessionModelOptions.some((option) => option.value === currentModelValue);
  const currentModelFallbackLabel = currentSession?.model && currentSession?.modelProvider
    ? formatModelOptionLabel(currentSession.model, currentSession.modelProvider)
    : null;
  const disableModelSelect = sending || sessionModelSaving || (sessionModelLoading && sessionModelOptions.length === 0);

  const handleModelChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    try {
      await updateCurrentSessionModel(nextValue === DEFAULT_MODEL_VALUE ? null : nextValue);
    } catch (error) {
      toast.error(`${t('toolbar.sessionModelUpdateFailed')}: ${toUserMessage(error)}`);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label={t('toolbar.sessionModel')}
        className="h-8 min-w-[220px] max-w-[320px] text-xs"
        value={currentModelValue}
        onChange={handleModelChange}
        disabled={disableModelSelect}
        title={currentModelValue === DEFAULT_MODEL_VALUE
          ? t('toolbar.sessionModelDefault')
          : currentModelFallbackLabel || currentModelValue}
      >
        <option value={DEFAULT_MODEL_VALUE}>{t('toolbar.sessionModelDefault')}</option>
        {!hasCurrentModelOption && currentModelFallbackLabel ? (
          <option value={currentModelValue}>{currentModelFallbackLabel}</option>
        ) : null}
        {sessionModelLoading && sessionModelOptions.length === 0 ? (
          <option value={DEFAULT_MODEL_VALUE} disabled>{t('toolbar.sessionModelLoading')}</option>
        ) : null}
        {sessionModelOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {formatModelOptionLabel(option.name, option.provider)}
          </option>
        ))}
      </Select>

      {(sessionModelLoading || sessionModelSaving) ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              showThinking && 'bg-primary/10 text-primary',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
