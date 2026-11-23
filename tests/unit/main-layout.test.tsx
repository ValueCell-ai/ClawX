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
  it('uses a left/right shell on macOS with a top drag strip over content', () => {
    window.electron.platform = 'darwin';

    render(<MainLayout />);

    expect(screen.getByTestId('main-layout')).toHaveClass('flex-row');
    expect(screen.getByTestId('main-content')).toHaveClass('relative');
    expect(screen.getByTestId('mac-main-drag-region')).toHaveClass('drag-region');
  });

  it('keeps a top titlebar column shell on Windows', () => {
    window.electron.platform = 'win32';

    render(<MainLayout />);

    const layout = screen.getByTestId('main-layout');
    expect(layout).toHaveClass('flex-col');
    expect(layout).toHaveClass('bg-surface-sidebar');
    expect(screen.getByTestId('main-content')).not.toHaveClass('border-t');
    expect(screen.queryByTestId('mac-main-drag-region')).not.toBeInTheDocument();
  });
});
