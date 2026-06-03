/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls; uses
 * `bg-surface-sidebar` so the frameless strip matches the sidebar rail.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { hostApi } from '@/lib/host-api';

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS traffic lights live inside the sidebar area; keep the shell left/right.
    return null;
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    hostApi.window.isMaximized().then((val) => {
      setMaximized(val);
    });
  }, []);

  const handleMinimize = () => {
    void hostApi.window.minimize();
  };

  const handleMaximize = () => {
    hostApi.window.maximize().then(() => {
      hostApi.window.isMaximized().then((val) => {
        setMaximized(val);
      });
    });
  };

  const handleClose = () => {
    void hostApi.window.close();
  };

  return (
    <div
      data-testid="windows-titlebar"
      className="drag-region flex h-10 shrink-0 items-center justify-end bg-surface-sidebar"
    >
      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 transition-colors"
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 transition-colors"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
