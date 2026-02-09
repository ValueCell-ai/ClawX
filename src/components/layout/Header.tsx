/**
 * Header Component
 * Top navigation bar with page title and page-specific controls.
 * On the Chat page, shows session selector, refresh, thinking toggle, and new session.
 */
import { useLocation } from 'react-router-dom';
import { Terminal } from 'lucide-react';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';
import { Button } from '@/components/ui/button';

// Page titles mapping
const pageTitles: Record<string, string> = {
  '/': 'Chat',
  '/dashboard': 'Dashboard',
  '/channels': 'Channels',
  '/skills': 'Skills',
  '/cron': 'Cron Tasks',
  '/settings': 'Settings',
};

export function Header() {
  const location = useLocation();
  const currentTitle = pageTitles[location.pathname] || 'ClawX';
  const isChatPage = location.pathname === '/';
  const isDashboard = location.pathname === '/dashboard';

  const handleOpenDevConsole = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('gateway:getControlUiUrl') as { success: boolean; url?: string; error?: string };
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <h2 className="text-lg font-semibold">{currentTitle}</h2>
      
      {/* Chat-specific controls */}
      {isChatPage && <ChatToolbar />}

      {/* Dashboard specific controls - Dev Console Button */}
      {isDashboard && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-full border border-neutral-200 px-3 text-xs font-normal text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
          onClick={handleOpenDevConsole}
        >
          <Terminal className="h-3.5 w-3.5" />
          Gateway
        </Button>
      )}
    </header>
  );
}
