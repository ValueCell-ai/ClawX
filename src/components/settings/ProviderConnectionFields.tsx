import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import type { ProviderAccount } from '@/stores/providers';
import { modelFieldClasses } from './ModelConfigDialog';

/** Shared connection fields; creation and editing retain their own lifecycle. */
export function ProviderConnectionFields({ prefix, baseUrl, onBaseUrlChange, modelId, onModelChange, protocol, onProtocolChange, showBaseUrl, showModel, showProtocol, modelLocked = false, configuredModels, modelPlaceholder, modelTestId, baseUrlTestId }: {
  prefix: string;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  modelId: string;
  onModelChange: (value: string) => void;
  protocol: ProviderAccount['apiProtocol'];
  onProtocolChange: (value: ProviderAccount['apiProtocol']) => void;
  showBaseUrl: boolean;
  showModel: boolean;
  showProtocol: boolean;
  modelLocked?: boolean;
  configuredModels?: string[];
  modelPlaceholder?: string;
  modelTestId: string;
  baseUrlTestId: string;
}) {
  const { t } = useTranslation('settings');
  const savedModels = configuredModels ?? (modelId ? [modelId] : []);
  return (
    <div className="space-y-4">
      {showBaseUrl && <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-base-url`}>{t('aiProviders.dialog.baseUrl')}</Label>
        <Input id={`${prefix}-base-url`} value={baseUrl} onChange={event => onBaseUrlChange(event.target.value)} placeholder={protocol === 'anthropic-messages' ? 'https://api.example.com/anthropic' : 'https://api.example.com/v1'} className={modelFieldClasses} data-testid={baseUrlTestId} />
      </div>}
      {showModel && <div className="space-y-1.5">
        {modelLocked ? <>
          <p id={`${prefix}-model-label`} className="text-sm font-medium leading-none">{t('aiProviders.dialog.configuredModels')}</p>
          {savedModels.length > 0 ? <ul data-testid={modelTestId} aria-labelledby={`${prefix}-model-label`} className="flex flex-wrap gap-1.5 pt-0.5">
            {savedModels.map(model => <li key={model} className="max-w-full break-all rounded-md bg-black/5 px-2.5 py-1 text-sm text-foreground dark:bg-white/10">{model}</li>)}
          </ul> : <p data-testid={modelTestId} className="text-sm text-muted-foreground">{t('modelManagement.notConfigured')}</p>}
        </> : <>
          <Label htmlFor={`${prefix}-model`}>{t('aiProviders.dialog.modelId')}</Label>
          <Input id={`${prefix}-model`} value={modelId} onChange={event => onModelChange(event.target.value)} placeholder={modelPlaceholder || 'model-id'} className={modelFieldClasses} data-testid={modelTestId} aria-describedby={`${prefix}-model-help`} />
          <p id={`${prefix}-model-help`} className="text-xs leading-relaxed text-muted-foreground">{t('aiProviders.dialog.singleModelHint')}</p>
        </>}
      </div>}
      {showProtocol && <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-protocol`}>{t('aiProviders.dialog.protocol')}</Label>
        <Select id={`${prefix}-protocol`} value={protocol || 'openai-completions'} onValueChange={value => onProtocolChange(value as ProviderAccount['apiProtocol'])} className={modelFieldClasses}>
          <SelectItem value="openai-completions">{t('aiProviders.protocols.openaiCompletions')}</SelectItem>
          <SelectItem value="openai-responses">{t('aiProviders.protocols.openaiResponses')}</SelectItem>
          <SelectItem value="anthropic-messages">{t('aiProviders.protocols.anthropic')}</SelectItem>
        </Select>
      </div>}
    </div>
  );
}
