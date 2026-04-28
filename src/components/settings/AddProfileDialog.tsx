import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AddProfileDialogProps {
  providerLabel: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { label: string; apiKey: string; addAsFallback: boolean }) => Promise<void>;
}

export function AddProfileDialog({ providerLabel, open, onClose, onSubmit }: AddProfileDialogProps) {
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [addAsFallback, setAddAsFallback] = useState(true);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="add-profile-dialog">
      <div className="w-full max-w-md rounded-2xl bg-background p-5 border border-black/10 dark:border-white/10 space-y-4">
        <h3 className="text-base font-semibold">Add profile for {providerLabel}</h3>
        <div className="space-y-2">
          <Label>Profile Name</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="add-profile-label-input" />
        </div>
        <div className="space-y-2">
          <Label>API Key</Label>
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} data-testid="add-profile-api-key-input" />
        </div>
        <div className="space-y-2 text-sm">
          <Label>Fallback Position</Label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={!addAsFallback} onChange={() => setAddAsFallback(false)} />
            Primary (replace existing)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={addAsFallback} onChange={() => setAddAsFallback(true)} />
            Fallback (add to chain end)
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="add-profile-submit-button"
            disabled={saving || !label.trim() || !apiKey.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit({ label: label.trim(), apiKey: apiKey.trim(), addAsFallback });
                setLabel('');
                setApiKey('');
                setAddAsFallback(true);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            Add Profile
          </Button>
        </div>
      </div>
    </div>
  );
}
