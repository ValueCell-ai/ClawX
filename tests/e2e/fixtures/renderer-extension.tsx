import { rendererExtensionRegistry } from '../../../src/extensions/registry';

// Substituted for the generated bridge only in this test's isolated renderer
// build. No enterprise package, account, or product test hook is needed.
export function loadExternalRendererExtensions(): void {
  function ExtensionPage() {
    return <div data-testid="extension-route-page">Extension route fixture</div>;
  }

  function ExtensionIcon() {
    return null;
  }

  rendererExtensionRegistry.register({
    id: 'e2e-extension',
    routes: {
      id: 'e2e-extension-routes',
      routes: [{ path: '/extension-test', component: ExtensionPage }],
    },
    sidebar: {
      id: 'e2e-extension-sidebar',
      navItems: [{
        to: '/extension-test',
        icon: ExtensionIcon,
        label: 'Extension fixture',
        testId: 'extension-route-nav',
      }],
    },
    setup: () => new Promise<void>(() => {}),
  });
}
