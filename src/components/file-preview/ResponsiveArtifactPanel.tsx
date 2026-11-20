import { lazy, Suspense, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import type { ArtifactPanelProps } from './ArtifactPanel';

const ArtifactPanel = lazy(() => import('./ArtifactPanel'));
const PanelResizeDivider = lazy(() => import('./PanelResizeDivider'));

export function ResponsiveArtifactPanel({ containerRef, ...props }: ArtifactPanelProps & { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation('chat');
  const close = useArtifactPanel(state => state.close);
  const widthPct = useArtifactPanel(state => state.widthPct);
  const media = useMemo(() => window.matchMedia('(min-width: 1024px)'), []);
  const subscribe = useCallback((listener: () => void) => {
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [media]);
  const wide = useSyncExternalStore(subscribe, () => media.matches, () => true);
  const content = <Suspense fallback={<div className="flex h-full items-center justify-center"><LoadingSpinner /></div>}><ArtifactPanel {...props} /></Suspense>;
  if (wide) return <>
    <Suspense fallback={null}><PanelResizeDivider containerRef={containerRef} /></Suspense>
    <aside data-testid="artifact-panel-aside" aria-label={t('workspace.title')} className="no-drag relative z-20 flex shrink-0 flex-col overflow-hidden border-l border-border/60" style={{ width: `${widthPct}%`, minWidth: 320, maxWidth: 'calc(100% - 280px)' }}>{content}</aside>
  </>;
  return (
    <Sheet open onOpenChange={open => { if (!open) close(); }}>
      <SheetContent side="right" data-testid="artifact-panel-aside" className="no-drag inset-y-2 right-2 flex h-[calc(100%-16px)] w-[calc(100vw-16px)] max-w-[860px] flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-surface-modal p-0 sm:max-w-[860px]"
        aria-describedby={undefined}
        onCloseAutoFocus={event => {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>('[data-testid="chat-toolbar-workspace"]')?.focus();
        }}>
        <SheetTitle className="sr-only">{t('workspace.title')}</SheetTitle>
        {content}
      </SheetContent>
    </Sheet>
  );
}
export default ResponsiveArtifactPanel;
