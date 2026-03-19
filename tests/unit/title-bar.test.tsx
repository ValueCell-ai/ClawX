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

  it('renders macOS drag region', () => {
    window.electron.platform = 'darwin';

    const { container } = render(<TitleBar />);

    expect(container.querySelector('.drag-region')).toBeInTheDocument();
    expect(screen.queryByTitle('Minimize')).not.toBeInTheDocument();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });

  it('renders custom controls on Windows', async () => {
    window.electron.platform = 'win32';

    render(<TitleBar />);

    expect(screen.getByTitle('Minimize')).toBeInTheDocument();
    expect(screen.getByTitle('Maximize')).toBeInTheDocument();
    expect(screen.getByTitle('Close')).toBeInTheDocument();

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
