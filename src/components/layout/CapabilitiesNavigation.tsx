import { Bot, Puzzle } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function CapabilitiesNavigation() {
  const { t } = useTranslation('common');
  return (
    <nav aria-label={t('sidebar.capabilities')} className="mb-5 flex shrink-0 gap-1 border-b border-border/60 pb-3">
      {[
        { to: '/agents', label: t('sidebar.agents'), icon: Bot, id: 'agents' },
        { to: '/skills', label: t('sidebar.skills'), icon: Puzzle, id: 'skills' },
      ].map(({ to, label, icon: Icon, id }) => (
        <NavLink key={id} to={to} data-testid={`capabilities-tab-${id}`} className={({ isActive }) => cn(
          'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isActive ? 'bg-black/5 font-medium text-foreground dark:bg-white/10' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5',
        )}><Icon aria-hidden="true" className="h-4 w-4" />{label}</NavLink>
      ))}
    </nav>
  );
}
