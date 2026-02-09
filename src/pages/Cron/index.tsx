/**
 * Cron Page
 * Manage scheduled tasks
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Clock,
  Play,
  Pause,
  Trash2,
  Edit,
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCronStore } from '@/stores/cron';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { formatRelativeTime, cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CronJob, CronJobCreateInput, ScheduleType } from '@/types/cron';
import { CHANNEL_ICONS } from '@/types/channel';

// Common cron schedule presets
const schedulePresets: { label: string; value: string; type: ScheduleType }[] = [
  { label: 'Every minute', value: '* * * * *', type: 'interval' },
  { label: 'Every 5 minutes', value: '*/5 * * * *', type: 'interval' },
  { label: 'Every 15 minutes', value: '*/15 * * * *', type: 'interval' },
  { label: 'Every hour', value: '0 * * * *', type: 'interval' },
  { label: 'Daily at 9am', value: '0 9 * * *', type: 'daily' },
  { label: 'Daily at 6pm', value: '0 18 * * *', type: 'daily' },
  { label: 'Weekly (Mon 9am)', value: '0 9 * * 1', type: 'weekly' },
  { label: 'Monthly (1st at 9am)', value: '0 9 1 * *', type: 'monthly' },
];

// Parse cron schedule to human-readable format
// Handles both plain cron strings and Gateway CronSchedule objects:
//   { kind: "cron", expr: "...", tz?: "..." }
//   { kind: "every", everyMs: number }
//   { kind: "at", at: "..." }
function parseCronSchedule(schedule: unknown): string {
  // Handle Gateway CronSchedule object format
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string; tz?: string; everyMs?: number; at?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') {
      return parseCronExpr(s.expr);
    }
    if (s.kind === 'every' && typeof s.everyMs === 'number') {
      const ms = s.everyMs;
      if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`;
      if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)} minutes`;
      if (ms < 86_400_000) return `Every ${Math.round(ms / 3_600_000)} hours`;
      return `Every ${Math.round(ms / 86_400_000)} days`;
    }
    if (s.kind === 'at' && typeof s.at === 'string') {
      try {
        return `Once at ${new Date(s.at).toLocaleString()}`;
      } catch {
        return `Once at ${s.at}`;
      }
    }
    return String(schedule);
  }

  // Handle plain cron string
  if (typeof schedule === 'string') {
    return parseCronExpr(schedule);
  }

  return String(schedule ?? 'Unknown');
}

// Parse a plain cron expression string to human-readable text
function parseCronExpr(cron: string): string {
  const preset = schedulePresets.find((p) => p.value === cron);
  if (preset) return preset.label;

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  if (minute === '*' && hour === '*') return 'Every minute';
  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`;
  if (hour === '*' && minute === '0') return 'Every hour';
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Weekly on ${days[parseInt(dayOfWeek)]} at ${hour}:${minute.padStart(2, '0')}`;
  }
  if (dayOfMonth !== '*') {
    return `Monthly on day ${dayOfMonth} at ${hour}:${minute.padStart(2, '0')}`;
  }
  if (hour !== '*') {
    return `Daily at ${hour}:${minute.padStart(2, '0')}`;
  }

  return cron;
}

// Create/Edit Task Dialog
interface TaskDialogProps {
  job?: CronJob;
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}

function TaskDialog({ job, onClose, onSave }: TaskDialogProps) {
  const { channels } = useChannelsStore();
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
  const [channelId, setChannelId] = useState(job?.target.channelId || '');
  const [discordChannelId, setDiscordChannelId] = useState('');
  const [enabled, setEnabled] = useState(job?.enabled ?? true);

  const selectedChannel = channels.find((c) => c.id === channelId);
  const isDiscord = selectedChannel?.type === 'discord';

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Please enter a task name');
      return;
    }
    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }
    if (!channelId) {
      toast.error('Please select a channel');
      return;
    }
    // Validate Discord channel ID when Discord is selected
    if (selectedChannel?.type === 'discord' && !discordChannelId.trim()) {
      toast.error('Please enter a Discord Channel ID');
      return;
    }

    const finalSchedule = useCustom ? customSchedule : schedule;
    if (!finalSchedule.trim()) {
      toast.error('Please select or enter a schedule');
      return;
    }

    setSaving(true);
    try {
      // For Discord, use the manually entered channel ID; for others, use empty
      const actualChannelId = selectedChannel!.type === 'discord'
        ? discordChannelId.trim()
        : '';

      await onSave({
        name: name.trim(),
        message: message.trim(),
        schedule: finalSchedule,
        target: {
          channelType: selectedChannel!.type,
          channelId: actualChannelId,
          channelName: selectedChannel!.name,
        },
        enabled,
      });
      onClose();
      toast.success(job ? 'Task updated' : 'Task created');
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>{job ? 'Edit Task' : 'Create Task'}</CardTitle>
            <CardDescription>Schedule an automated AI task</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Task Name</Label>
            <Input
              id="name"
              placeholder="e.g., Morning briefing"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message">Message / Prompt</Label>
            <Textarea
              id="message"
              placeholder="What should the AI do? e.g., Give me a summary of today's news and weather"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </div>

          {/* Schedule */}
          <div className="space-y-2">
            <Label>Schedule</Label>
            {!useCustom ? (
              <div className="grid grid-cols-2 gap-2">
                {schedulePresets.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={schedule === preset.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSchedule(preset.value)}
                    className="justify-start"
                  >
                    <Timer className="h-4 w-4 mr-2" />
                    {preset.label}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                placeholder="Cron expression (e.g., 0 9 * * *)"
                value={customSchedule}
                onChange={(e) => setCustomSchedule(e.target.value)}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setUseCustom(!useCustom)}
              className="text-xs"
            >
              {useCustom ? 'Use presets' : 'Use custom cron'}
            </Button>
          </div>

          {/* Target Channel */}
          <div className="space-y-2">
            <Label>Target Channel</Label>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No channels available. Add a channel first.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {channels.map((channel) => (
                  <Button
                    key={channel.id}
                    type="button"
                    variant={channelId === channel.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setChannelId(channel.id)}
                    className="justify-start"
                  >
                    <span className="mr-2">{CHANNEL_ICONS[channel.type]}</span>
                    {channel.name}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Discord Channel ID - only shown when Discord is selected */}
          {isDiscord && (
            <div className="space-y-2">
              <Label>Discord Channel ID</Label>
              <Input
                value={discordChannelId}
                onChange={(e) => setDiscordChannelId(e.target.value)}
                placeholder="e.g., 1438452657525100686"
              />
              <p className="text-xs text-muted-foreground">
                Right-click the Discord channel → Copy Channel ID
              </p>
            </div>
          )}
          {/* Enabled */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable immediately</Label>
              <p className="text-sm text-muted-foreground">
                Start running this task after creation
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {job ? 'Save Changes' : 'Create Task'}
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
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
}

function CronJobCard({ job, onToggle, onEdit, onDelete, onTrigger }: CronJobCardProps) {
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await onTrigger();
      toast.success('Task triggered successfully');
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      toast.error(`Failed to trigger task: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this task?')) {
      onDelete();
    }
  };

  return (
    <Card className={cn(
      'transition-colors',
      job.enabled && 'border-primary/30'
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'rounded-full p-2',
              job.enabled
                ? 'bg-green-100 dark:bg-green-900/30'
                : 'bg-muted'
            )}>
              <Clock className={cn(
                'h-5 w-5',
                job.enabled ? 'text-green-600' : 'text-muted-foreground'
              )} />
            </div>
            <div>
              <CardTitle className="text-lg">{job.name}</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <Timer className="h-3 w-3" />
                {parseCronSchedule(job.schedule)}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={job.enabled ? 'success' : 'secondary'}>
              {job.enabled ? 'Active' : 'Paused'}
            </Badge>
            <Switch
              checked={job.enabled}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Message Preview */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
          <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground line-clamp-2">
            {job.message}
          </p>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            {CHANNEL_ICONS[job.target.channelType]}
            {job.target.channelName}
          </span>

          {job.lastRun && (
            <span className="flex items-center gap-1">
              <History className="h-4 w-4" />
              Last: {formatRelativeTime(job.lastRun.time)}
              {job.lastRun.success ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </span>
          )}

          {job.nextRun && job.enabled && (
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              Next: {new Date(job.nextRun).toLocaleString()}
            </span>
          )}
        </div>

        {/* Last Run Error */}
        {job.lastRun && !job.lastRun.success && job.lastRun.error && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{job.lastRun.error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-1 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTrigger}
            disabled={triggering}
          >
            {triggering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span className="ml-1">Run Now</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4" />
            <span className="ml-1">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
            <span className="ml-1 text-destructive">Delete</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function Cron() {
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const { fetchChannels } = useChannelsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();

  const isGatewayRunning = gatewayStatus.state === 'running';

  // Fetch jobs and channels on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchJobs();
      fetchChannels();
    }
  }, [fetchJobs, fetchChannels, isGatewayRunning]);

  // Statistics
  const activeJobs = jobs.filter((j) => j.enabled);
  const pausedJobs = jobs.filter((j) => !j.enabled);
  const failedJobs = jobs.filter((j) => j.lastRun && !j.lastRun.success);

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
      toast.success(enabled ? 'Task enabled' : 'Task paused');
    } catch {
      toast.error('Failed to update task');
    }
  }, [toggleJob]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteJob(id);
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  }, [deleteJob]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Tasks</h1>
          <p className="text-muted-foreground">
            Automate AI workflows with scheduled tasks
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchJobs} disabled={!isGatewayRunning}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            onClick={() => {
              setEditingJob(undefined);
              setShowDialog(true);
            }}
            disabled={!isGatewayRunning}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      {/* Gateway Warning */}
      {!isGatewayRunning && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <span className="text-yellow-700 dark:text-yellow-400">
              Gateway is not running. Scheduled tasks cannot be managed without an active Gateway.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{jobs.length}</p>
                <p className="text-sm text-muted-foreground">Total Tasks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/30">
                <Play className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeJobs.length}</p>
                <p className="text-sm text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-yellow-100 p-3 dark:bg-yellow-900/30">
                <Pause className="h-6 w-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pausedJobs.length}</p>
                <p className="text-sm text-muted-foreground">Paused</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{failedJobs.length}</p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Error Display */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* Jobs List */}
      {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No scheduled tasks</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-md">
              Create scheduled tasks to automate AI workflows.
              Tasks can send messages, run queries, or perform actions at specified times.
            </p>
            <Button
              onClick={() => {
                setEditingJob(undefined);
                setShowDialog(true);
              }}
              disabled={!isGatewayRunning}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <CronJobCard
              key={job.id}
              job={job}
              onToggle={(enabled) => handleToggle(job.id, enabled)}
              onEdit={() => {
                setEditingJob(job);
                setShowDialog(true);
              }}
              onDelete={() => handleDelete(job.id)}
              onTrigger={() => triggerJob(job.id)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      {showDialog && (
        <TaskDialog
          job={editingJob}
          onClose={() => {
            setShowDialog(false);
            setEditingJob(undefined);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

export default Cron;
