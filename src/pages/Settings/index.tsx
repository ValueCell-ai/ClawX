import { Info, Settings2, SlidersHorizontal } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { SettingsPreferences } from './Preferences';

const categories = [
  { id: 'general', icon: Settings2 },
  { id: 'advanced', icon: SlidersHorizontal },
  { id: 'about', icon: Info },
] as const;
type SettingsCategory = typeof categories[number]['id'];

export function Settings() {
  const { t } = useTranslation('settings');
  const { pathname, search } = useLocation();
  const requested = pathname.split('/')[2];
  const legacyDeveloper = !requested && new URLSearchParams(search).get('section') === 'developer';
  const active: SettingsCategory = legacyDeveloper ? 'advanced'
    : categories.find(({ id }) => id === requested)?.id ?? 'general';

  if (requested && ['models', 'channels', 'computer-use'].includes(requested)) {
    return <Navigate replace to={`/${requested}${search}`} />;
  }

  return (
    <div data-testid="settings-page" className="-m-6 flex h-[calc(100%+3rem)] min-w-0 flex-col overflow-hidden lg:flex-row">
      <aside className="shrink-0 border-b border-border/60 bg-surface-sidebar/40 px-6 pb-3 pt-6 md:px-8 lg:w-48 lg:border-b-0 lg:border-r lg:px-4 lg:py-8">
        <p className="mb-4 px-2 text-sm font-medium text-foreground/80">{t('title')}</p>
        <nav aria-label={t('navigation.label')} className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
          {categories.map(({ id, icon: Icon }) => (
            <Link key={id} to={`/settings/${id}`} data-testid={`settings-nav-${id}`}
              aria-current={active === id ? 'page' : undefined}
              className={cn('flex shrink-0 items-center gap-2.5 whitespace-nowrap lg:whitespace-normal rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active === id ? 'bg-black/5 font-medium text-foreground dark:bg-white/10' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5')}>
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              {t(`navigation.${id}.title`)}
            </Link>
          ))}
        </nav>
      </aside>
      <div data-testid="settings-category-content" className="min-h-0 min-w-0 flex-1">
        <SettingsPreferences section={active} />
      </div>
    </div>
  );
}
