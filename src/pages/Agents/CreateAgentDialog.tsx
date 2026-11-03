import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ModelPicker } from '@/components/common/ModelPicker';
import { formatModelRefLabel, resolveConfiguredModelRef } from '@/lib/model-options';
import { useAgentsStore } from '@/stores/agents';
import { useAgentModels } from './use-agent-models';

export function CreateAgentDialog({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, options: { inheritWorkspace: boolean; instructions: string; modelRef: string }) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const modelOptions = useAgentModels();
  const agents = useAgentsStore(state => state.agents);
  const defaultAgentId = useAgentsStore(state => state.defaultAgentId);
  const mainModel = agents.find(agent => agent.id === (defaultAgentId || 'main'))?.modelRef;
  const [modelChoice, setModelChoice] = useState<string | null>(null);
  const modelRef = modelChoice ?? resolveConfiguredModelRef(mainModel, null, modelOptions);
  const selectedModel = modelOptions.find(option => option.modelRef === modelRef);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [inheritWorkspace, setInheritWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) { setName(''); setInstructions(''); setInheritWorkspace(false); setSaving(false); setModelChoice(null); }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !name.trim() || !selectedModel) return;
    setSaving(true);
    try { await onCreate(name.trim(), { inheritWorkspace, instructions: instructions.trim(), modelRef: selectedModel.modelRef }); }
    catch (error) { toast.error(t('toast.agentCreateFailed', { error: String(error) })); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value && !saving) onClose(); }}>
    <DialogContent data-testid="add-agent-dialog" className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-xl bg-surface-modal p-0">
      <div className="shrink-0 px-6 pb-4 pt-6 pr-14">
        <DialogTitle className="font-sans text-xl font-medium tracking-normal">{t('createDialog.title')}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t('createDialog.description')}</DialogDescription>
      </div>
      <Button variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8" aria-label={t('profile.close')} title={t('profile.close')} disabled={saving} onClick={onClose}><X className="h-4 w-4" /></Button>
      <form onSubmit={submit} className="min-h-0 overflow-y-auto px-6 pb-6">
        <div className="space-y-5">
          <div className="space-y-2"><Label htmlFor="agent-name" className="text-sm font-medium">{t('createDialog.nameLabel')}</Label><Input id="agent-name" value={name} onChange={event => setName(event.target.value)} placeholder={t('createDialog.namePlaceholder')} className="h-9 font-sans" disabled={saving} maxLength={120} /></div>
          <div className="space-y-2">
            <span id="agent-create-model-label" className="text-sm font-medium">{t('settingsDialog.modelLabel')}</span>
            <ModelPicker options={modelOptions} value={modelRef} label={selectedModel?.modelId || (modelRef ? formatModelRefLabel(modelRef) : t('profile.notConfigured'))}
              title={t('settingsDialog.modelLabel')} labelledBy="agent-create-model-label" testIdPrefix="agent-create-model-picker"
              onValueChange={setModelChoice} disabled={saving} side="bottom" align="start"
              className="h-9 w-full max-w-none border border-input bg-surface-modal px-3 text-sm font-normal text-foreground sm:max-w-none" />
            <p className="text-xs leading-relaxed text-muted-foreground">{t('profile.modelHint')}</p>
            {!modelOptions.length && <div className="space-y-1 text-xs text-muted-foreground"><p>{t('settingsDialog.modelProviderEmpty')}</p><Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => { onClose(); navigate('/models'); }}>{t('profile.manageModels')}</Button></div>}
          </div>
          <div className="space-y-2"><Label htmlFor="agent-instructions" className="text-sm font-medium">{t('profile.workStyle')} <span className="font-normal text-muted-foreground">{t('createDialog.optional')}</span></Label><Textarea id="agent-instructions" data-testid="agent-create-instructions" value={instructions} onChange={event => setInstructions(event.target.value)} placeholder={t('createDialog.instructionsPlaceholder')} rows={4} maxLength={4000} className="resize-y text-sm leading-relaxed" disabled={saving} /><p className="text-xs leading-relaxed text-muted-foreground">{t('createDialog.instructionsHint')}</p></div>
          <div className="flex items-start justify-between gap-4"><div className="space-y-1"><Label htmlFor="inherit-workspace" className="text-sm font-medium">{t('createDialog.inheritWorkspaceLabel')}</Label><p className="text-xs leading-relaxed text-muted-foreground">{t('createDialog.inheritWorkspaceDescription')}</p></div><Switch id="inherit-workspace" checked={inheritWorkspace} onCheckedChange={setInheritWorkspace} disabled={saving} className="mt-0.5 shrink-0" /></div>
        </div>
        <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" className="h-9" onClick={onClose} disabled={saving}>{t('common:actions.cancel')}</Button><Button type="submit" className="h-9" disabled={saving || !name.trim() || !selectedModel}>{saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{saving ? t('creating') : t('createDialog.submit')}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
