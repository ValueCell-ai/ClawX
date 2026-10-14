import { Cpu, Info, MessageCircle, Monitor, Settings2, SlidersHorizontal } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Models } from '@/pages/Models';
import { Channels } from '@/pages/Channels';
import { ComputerUse } from '@/pages/ComputerUse';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { SettingsPreferences } from './Preferences';

const categories = [
  { id: 'general', icon: Settings2 },
  { id: 'models', icon: Cpu },
  { id: 'channels', icon: MessageCircle },
  { id: 'computer-use', icon: Monitor },
  { id: 'advanced', icon: SlidersHorizontal },
  { id: 'about', icon: Info },
] as const;
type SettingsCategory = typeof categories[number]['id'];

export function Settings() {
  const { t } = useTranslation('settings');
  const { pathname, search } = useLocation();
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const requested = pathname.split('/')[2];
  const legacyDeveloper = !requested && new URLSearchParams(search).get('section') === 'developer';
  const active: SettingsCategory = legacyDeveloper ? 'advanced'
    : categories.find(({ id }) => id === requested)?.id ?? 'general';

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
        {active === 'models' ? <Models embedded />
          : active === 'channels' ? <Channels embedded />
          : active === 'computer-use' ? (devModeUnlocked ? <ComputerUse embedded /> : (
            <div className="mx-auto flex h-full max-w-6xl flex-col p-6 md:p-8">
              <h1 className="mb-1 font-sans text-2xl font-medium tracking-normal">{t('navigation.computer-use.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('navigation.computer-use.description')}</p>
              <div className="mt-6 rounded-xl border border-border/70 bg-surface-modal p-5">
                <p className="text-sm text-muted-foreground">{t('navigation.computer-use.developerHint')}</p>
                <Link to="/settings/advanced" className="mt-3 inline-flex text-sm font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-400">{t('navigation.openAdvanced')}</Link>
              </div>
            </div>
          )) : <SettingsPreferences section={active} />}
      </div>
    </div>
  );
}
