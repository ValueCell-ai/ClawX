/**
 * Main Layout Component
 * Full-width title bar at the top for drag, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function MainLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Top title bar - full width drag region */}
      <div className="drag-region h-10 shrink-0 border-b bg-background" />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
