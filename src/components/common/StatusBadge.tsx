/**
 * Status Badge Component
 * Displays connection/state status with color coding
 */
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export type Status = 'connected' | 'disconnected' | 'connecting' | 'error' | 'running' | 'stopped' | 'starting' | 'reconnecting';

interface StatusBadgeProps {
  status: Status;
  label?: string;
  showDot?: boolean;
}

const statusConfig: Record<Status, { label: string; variant: 'success' | 'secondary' | 'warning' | 'destructive' }> = {
  connected: { label: 'Connected', variant: 'success' },
  running: { label: 'Running', variant: 'success' },
  disconnected: { label: 'Disconnected', variant: 'secondary' },
  stopped: { label: 'Stopped', variant: 'secondary' },
  connecting: { label: 'Connecting', variant: 'warning' },
  starting: { label: 'Starting', variant: 'warning' },
  reconnecting: { label: 'Reconnecting', variant: 'warning' },
  error: { label: 'Error', variant: 'destructive' },
};

export function StatusBadge({ status, label, showDot = true }: StatusBadgeProps) {
  const config = statusConfig[status];
  const displayLabel = label || config.label;
  
  return (
    <Badge variant={config.variant} className="gap-1.5">
      {showDot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            config.variant === 'success' && 'bg-green-600',
            config.variant === 'secondary' && 'bg-muted-foreground',
            config.variant === 'warning' && 'bg-yellow-600 animate-pulse',
            config.variant === 'destructive' && 'bg-red-600'
          )}
        />
      )}
      {displayLabel}
    </Badge>
  );
}
