import { useLayoutEffect, useRef } from 'react';
import { Info, Settings2, SlidersHorizontal } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);
  const requested = pathname.split('/')[2];
  const legacyDeveloper = !requested && new URLSearchParams(search).get('section') === 'developer';
  const active: SettingsCategory = legacyDeveloper ? 'advanced'
    : categories.find(({ id }) => id === requested)?.id ?? 'general';

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [active]);

  if (requested && ['models', 'channels', 'computer-use'].includes(requested)) {
    return <Navigate replace to={`/${requested}${search}`} />;
  }

  return (
    <div data-testid="settings-page" className="-m-6 flex h-[calc(100%+3rem)] min-w-0 flex-col overflow-hidden">
      <Tabs
        value={active}
        activationMode="manual"
        onValueChange={(value) => navigate(`/settings/${value}`)}
        className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col p-6 md:p-8"
      >
        <h1 className="mb-4 shrink-0 font-sans text-2xl font-medium tracking-normal text-foreground">{t('title')}</h1>
        <TabsList variant="page" aria-label={t('navigation.label')} className="mb-5 shrink-0">
          {categories.map(({ id, icon: Icon }) => (
            <TabsTrigger key={id} value={id} variant="page" data-testid={`settings-nav-${id}`}>
              <Icon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
              {t(`navigation.${id}.title`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={active} ref={contentRef} data-testid="settings-category-content"
          className="-mr-2 mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto pr-2 focus-visible:ring-inset">
          <SettingsPreferences section={active} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
