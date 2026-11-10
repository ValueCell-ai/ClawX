import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { rendererExtensionRegistry } from '@/extensions/registry';

const { setup, teardown, settings, lifecycle } = vi.hoisted(() => ({
  setup: vi.fn(() => new Promise<void>(() => {})),
  teardown: vi.fn(),
  settings: { init: () => new Promise<void>(() => {}), language: 'en', setupComplete: true },
  lifecycle: { init: () => undefined },
}));

vi.mock('@/i18n', () => ({ default: { language: 'en' } }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settings) => unknown) => selector(settings),
}));
vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof lifecycle) => unknown) => selector(lifecycle),
}));
vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof lifecycle) => unknown) => selector(lifecycle),
}));
vi.mock('@/stores/update', () => ({
  useUpdateStore: (selector: (state: typeof lifecycle) => unknown) => selector(lifecycle),
}));
vi.mock('@/lib/use-resolved-theme', () => ({ useResolvedTheme: () => 'light' }));
vi.mock('@/lib/host-events', () => ({ hostEvents: { onNavigate: vi.fn(), onNewChat: vi.fn() } }));
vi.mock('@/components/layout/use-new-chat-action', () => ({ useNewChatAction: () => undefined }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: () => <Outlet /> }));
vi.mock('@/components/update/UpdateNotifier', () => ({ UpdateNotifier: () => null }));
vi.mock('@/pages/Chat', () => ({ Chat: () => <div>Built-in chat</div> }));
vi.mock('@/pages/Models', () => ({ Models: () => null }));
vi.mock('@/pages/Agents', () => ({ Agents: () => null }));
vi.mock('@/pages/Channels', () => ({ Channels: () => null }));
vi.mock('@/pages/Skills', () => ({ Skills: () => null }));
vi.mock('@/pages/Cron', () => ({ Cron: () => null }));
vi.mock('@/pages/Settings', () => ({ Settings: () => null }));
vi.mock('@/pages/ComputerUse', () => ({ ComputerUse: () => null }));
vi.mock('@/pages/Setup', () => ({ Setup: () => null }));
vi.mock('@/extensions/_ext-bridge.generated', () => ({
  loadExternalRendererExtensions: () => rendererExtensionRegistry.register({
    id: 'test-extension',
    routes: {
      id: 'test-extension-routes',
      routes: [{ path: '/extension-test', component: () => <div>Extension page</div> }],
    },
    setup,
    teardown,
  }),
}));

afterEach(() => {
  cleanup();
  rendererExtensionRegistry.teardownAll();
});

function renderApp(path: string) {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></StrictMode>);
}

describe('renderer extension route startup', () => {
  it('renders a direct route while settings and extension setup are still pending, including remount', () => {
    const view = renderApp('/extension-test');

    expect(screen.getByText('Extension page')).toBeInTheDocument();
    expect(rendererExtensionRegistry.getAll()).toHaveLength(1);
    expect(setup).toHaveBeenCalledTimes(2);
    expect(teardown).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(rendererExtensionRegistry.getAll()).toHaveLength(0);
    expect(teardown).toHaveBeenCalledTimes(2);

    renderApp('/extension-test');
    expect(screen.getByText('Extension page')).toBeInTheDocument();
    expect(rendererExtensionRegistry.getAll()).toHaveLength(1);
  });

  it('keeps built-in routing available during extension initialization', () => {
    renderApp('/');
    expect(screen.getByText('Built-in chat')).toBeInTheDocument();
  });
});
