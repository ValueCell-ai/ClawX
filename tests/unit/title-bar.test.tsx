import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TitleBar } from '@/components/layout/TitleBar';

const isMaximizedMock = vi.hoisted(() => vi.fn());
const minimizeMock = vi.hoisted(() => vi.fn());
const maximizeMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    window: {
      isMaximized: (...args: unknown[]) => isMaximizedMock(...args),
      minimize: (...args: unknown[]) => minimizeMock(...args),
      maximize: (...args: unknown[]) => maximizeMock(...args),
      close: (...args: unknown[]) => closeMock(...args),
    },
  },
}));

describe('TitleBar platform behavior', () => {
  beforeEach(() => {
    isMaximizedMock.mockReset();
    minimizeMock.mockReset();
    maximizeMock.mockReset();
    closeMock.mockReset();
    isMaximizedMock.mockResolvedValue(false);
    minimizeMock.mockResolvedValue(undefined);
    maximizeMock.mockResolvedValue(undefined);
    closeMock.mockResolvedValue(undefined);
  });

  it('does not render a standalone title bar on macOS', () => {
    window.electron.platform = 'darwin';

    const { container } = render(<TitleBar />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTitle('Minimize')).not.toBeInTheDocument();
    expect(isMaximizedMock).not.toHaveBeenCalled();
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
      expect(isMaximizedMock).toHaveBeenCalled();
    });
  });

  it('renders no custom title bar on Linux', () => {
    window.electron.platform = 'linux';

    const { container } = render(<TitleBar />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTitle('Minimize')).not.toBeInTheDocument();
    expect(isMaximizedMock).not.toHaveBeenCalled();
  });
});
