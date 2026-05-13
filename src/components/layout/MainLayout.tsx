/**
 * Main Layout Component
 * Platform-aware application shell.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { cn } from '@/lib/utils';

export function MainLayout() {
  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  return (
    <div
      data-testid="main-layout"
      data-platform={platform}
      className={cn(
        'flex h-screen overflow-hidden',
        isWin ? 'bg-surface-sidebar' : 'bg-background',
        isMac ? 'flex-row' : 'flex-col',
      )}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-sidebar">
        <Sidebar />
        <main
          data-testid="main-content"
          className={cn(
            'min-h-0 flex-1 overflow-auto rounded-tl-2xl border-l border-border/60 bg-background p-6',
            !isWin && 'border-t border-border/60',
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
