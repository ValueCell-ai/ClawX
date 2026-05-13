import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainLayout } from '@/components/layout/MainLayout';

vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock('@/components/layout/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar" />,
}));

describe('MainLayout platform layout', () => {
  it('uses a left/right shell on macOS', () => {
    window.electron.platform = 'darwin';

    render(<MainLayout />);

    expect(screen.getByTestId('main-layout')).toHaveClass('flex-row');
  });

  it('keeps a top titlebar column shell on Windows', () => {
    window.electron.platform = 'win32';

    render(<MainLayout />);

    const layout = screen.getByTestId('main-layout');
    expect(layout).toHaveClass('flex-col');
    expect(layout).toHaveClass('bg-surface-sidebar');
    expect(screen.getByTestId('main-content')).not.toHaveClass('border-t');
  });
});
