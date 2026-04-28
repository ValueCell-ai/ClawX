import { ArrowDown, ArrowUp, Circle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProviderProfile } from '@/lib/providers';

interface ProviderProfileRowProps {
  profile: ProviderProfile;
  isPrimary: boolean;
  onMakePrimary: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function ProviderProfileRow({
  profile,
  isPrimary,
  onMakePrimary,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: ProviderProfileRowProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/10 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{profile.label}</p>
        <p className="text-xs text-muted-foreground truncate">{profile.id}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMakePrimary} title="Set primary">
          <Circle className={isPrimary ? 'h-4 w-4 fill-current text-green-600' : 'h-4 w-4'} />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveUp} disabled={!canMoveUp} title="Move up">
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMoveDown} disabled={!canMoveDown} title="Move down">
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title="Delete profile">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

export type { ProviderProfileRowProps };
