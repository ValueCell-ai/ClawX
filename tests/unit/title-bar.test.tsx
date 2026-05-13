import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TitleBar } from '@/components/layout/TitleBar';

const invokeIpcMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('TitleBar platform behavior', () => {
  beforeEach(() => {
    invokeIpcMock.mockReset();
    invokeIpcMock.mockResolvedValue(false);
  });

  it('does not render a standalone title bar on macOS', () => {
    window.electron.platform = 'darwin';

    const { container } = render(<TitleBar />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTitle('Minimize')).not.toBeInTheDocument();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });

  it('renders custom controls on Windows', async () => {
    window.electron.platform = 'win32';

    render(<TitleBar />);

    expect(screen.getByTitle('Minimize')).toBeInTheDocument();
    expect(screen.getByTitle('Maximize')).toBeInTheDocument();
    expect(screen.getByTitle('Close')).toBeInTheDocument();
    const bar = screen.getByTestId('windows-titlebar');
    expect(bar).toHaveClass('bg-surface-sidebar');
    expect(bar).not.toHaveClass('border-b');

    await waitFor(() => {
      expect(invokeIpcMock).toHaveBeenCalledWith('window:isMaximized');
    });
  });

  it('renders no custom title bar on Linux', () => {
    window.electron.platform = 'linux';

    const { container } = render(<TitleBar />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTitle('Minimize')).not.toBeInTheDocument();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });
});
