/**
 * Header Component
 * Top navigation bar with page title and page-specific controls.
 * On the Chat page, shows session selector, refresh, thinking toggle, and new session.
 */
import { useLocation } from 'react-router-dom';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';

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

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <h2 className="text-lg font-semibold">{currentTitle}</h2>
      
      {/* Chat-specific controls */}
      {isChatPage && <ChatToolbar />}
    </header>
  );
}
