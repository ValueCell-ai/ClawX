import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { ArtifactPanelProps } from './ArtifactPanel';

const ArtifactPanel = lazy(() => import('./ArtifactPanel'));
const PanelResizeDivider = lazy(() => import('./PanelResizeDivider'));

function getPanelSize(element: HTMLElement, drawer: boolean): Keyframe {
  const { width, height } = element.getBoundingClientRect();
  if (!drawer) return { width: `${width}px` };
  const { right, top } = getComputedStyle(element);
  return { width: `${width}px`, height: `${height}px`, right, top };
}

export function ResponsiveArtifactPanel({
  container, ...props
}: Omit<ArtifactPanelProps, 'maximized' | 'onToggleMaximized' | 'onClose'> & { container: HTMLDivElement }) {
  const { t } = useTranslation('chat');
  const close = useArtifactPanel(state => state.close);
  const maximized = useArtifactPanel(state => state.maximized);
  const toggleMaximized = useArtifactPanel(state => state.toggleMaximized);
  const widthPct = useArtifactPanel(state => state.widthPct);
  const media = useMemo(() => window.matchMedia('(min-width: 1024px)'), []);
  const subscribe = useCallback((listener: () => void) => {
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [media]);
  const wide = useSyncExternalStore(subscribe, () => media.matches, () => true);
  const panelRef = useRef<HTMLElement | null>(null);
  const sizeBeforeToggle = useRef<Keyframe | null>(null);
  const setPanel = useCallback((element: HTMLElement | null) => { panelRef.current = element; }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const from = sizeBeforeToggle.current;
    sizeBeforeToggle.current = null;
    if (!panel || !from) return;
    const animation = panel.animate?.([from, getPanelSize(panel, !wide)], { duration: 140, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [maximized, wide]);

  const togglePanelSize = () => {
    const panel = panelRef.current;
    if (panel && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sizeBeforeToggle.current = getPanelSize(panel, !wide);
    }
    toggleMaximized();
  };
  const focusWorkspaceButton = () => {
    container.querySelector<HTMLButtonElement>('[data-testid="chat-toolbar-workspace"]')?.focus();
  };
  const closePanel = () => {
    close();
    if (wide) requestAnimationFrame(focusWorkspaceButton);
  };
  const content = (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><LoadingSpinner /></div>}>
      <ArtifactPanel {...props} maximized={maximized} onToggleMaximized={togglePanelSize} onClose={closePanel} />
    </Suspense>
  );
  if (wide) {
    return (
      <>
        {!maximized && <Suspense fallback={null}><PanelResizeDivider container={container} /></Suspense>}
        <aside
          ref={setPanel}
          data-testid="artifact-panel-aside"
          aria-label={t('workspace.title')}
          className={cn(
            'no-drag relative z-20 ml-auto flex min-w-0 shrink-0 flex-col overflow-hidden',
            !maximized && 'border-l border-border/60',
          )}
          style={{ width: maximized ? '100%' : `clamp(320px, ${widthPct}%, calc(100% - 280px))` }}
        >
          {content}
        </aside>
      </>
    );
  }
  return (
    <Sheet open modal={false} onOpenChange={open => { if (!open) close(); }}>
      <SheetContent
        ref={setPanel}
        side="right"
        portalContainer={container}
        data-testid="artifact-panel-aside"
        className={cn(
          'no-drag absolute flex max-w-none flex-col gap-0 overflow-hidden bg-surface-modal p-0 sm:max-w-none',
          maximized
            ? 'inset-0 h-full w-full rounded-none border-0 shadow-none'
            : 'inset-y-2 right-2 h-[calc(100%-16px)] w-[min(860px,calc(100%-16px))] rounded-2xl border border-border',
        )}
        aria-describedby={undefined}
        onInteractOutside={event => { if (maximized) event.preventDefault(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const active = document.activeElement;
          if (!active || active === document.body || active.closest('[data-testid="artifact-panel-aside"]')) focusWorkspaceButton();
        }}>
        <SheetTitle className="sr-only">{t('workspace.title')}</SheetTitle>
        {content}
      </SheetContent>
    </Sheet>
  );
}
export default ResponsiveArtifactPanel;
