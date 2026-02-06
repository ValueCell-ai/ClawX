/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { RefreshCw, Brain, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';

export function ChatToolbar() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);

  const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    switchSession(e.target.value);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Session Selector */}
      <div className="relative">
        <select
          value={currentSessionKey}
          onChange={handleSessionChange}
          className={cn(
            'appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8',
            'text-sm text-foreground cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-ring',
          )}
        >
          {/* Render all sessions; if currentSessionKey is not in the list, add it */}
          {!sessions.some((s) => s.key === currentSessionKey) && (
            <option value={currentSessionKey}>
              {currentSessionKey === 'main' ? 'main' : currentSessionKey}
            </option>
          )}
          {sessions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.displayName || s.label || s.key}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>

      {/* New Session */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={newSession}
        title="New session"
      >
        <Plus className="h-4 w-4" />
      </Button>

      {/* Refresh */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => refresh()}
        disabled={loading}
        title="Refresh chat"
      >
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
      </Button>

      {/* Thinking Toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-8 w-8',
          showThinking && 'bg-primary/10 text-primary',
        )}
        onClick={toggleThinking}
        title={showThinking ? 'Hide thinking' : 'Show thinking'}
      >
        <Brain className="h-4 w-4" />
      </Button>
    </div>
  );
}
