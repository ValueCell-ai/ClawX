import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GatewayDiagnosticsBanner } from '@/components/diagnostics/GatewayDiagnosticsBanner';
import type { GatewayStatus, GatewayStartupDiagnosticSnapshot } from '@/types/gateway';

type GatewayState = { status: GatewayStatus };

const { gatewayState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  } as GatewayState,
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: GatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Echo the key so tests can assert on it without depending on locale
    // resource loading.
    t: (key: string) => key,
  }),
}));

function buildAcpxDiagnostic(): GatewayStartupDiagnosticSnapshot {
  return {
    code: 'ACPX_VC_REDIST_MISSING',
    rawLine:
      '[plugins] embedded acpx runtime backend probe failed: '
      + 'embedded ACP runtime probe failed (agent=codex; exit=3221225781, signal=null)',
    detail: 'Embedded acpx ACP probe crashed with Windows STATUS_DLL_NOT_FOUND.',
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    occurrences: 1,
  };
}

describe('<GatewayDiagnosticsBanner />', () => {
  it('renders nothing when there are no active diagnostics', () => {
    gatewayState.status = { state: 'running', port: 18789 };
    const { container } = render(<GatewayDiagnosticsBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for unknown diagnostic codes', () => {
    gatewayState.status = {
      state: 'running',
      port: 18789,
      activeDiagnostics: [
        {
          // @ts-expect-error – deliberately unknown code
          code: 'SOMETHING_ELSE',
          rawLine: 'x',
          detail: 'x',
          firstSeenAt: 0,
          lastSeenAt: 0,
          occurrences: 1,
        },
      ],
    };
    const { container } = render(<GatewayDiagnosticsBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the ACPX_VC_REDIST_MISSING banner with a download button', () => {
    const openExternal = vi.fn();
    // @ts-expect-error — test shim
    globalThis.window.electron = { openExternal };

    gatewayState.status = {
      state: 'running',
      port: 18789,
      activeDiagnostics: [buildAcpxDiagnostic()],
    };

    render(<GatewayDiagnosticsBanner />);
    expect(
      screen.getByTestId('gateway-diagnostic-ACPX_VC_REDIST_MISSING'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('common:diagnostics.acpxVcRedistMissing.title'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('common:diagnostics.acpxVcRedistMissing.body'),
    ).toBeInTheDocument();

    const downloadBtn = screen.getByText(
      'common:diagnostics.acpxVcRedistMissing.downloadButton',
    );
    fireEvent.click(downloadBtn);
    expect(openExternal).toHaveBeenCalledWith(
      'https://aka.ms/vs/17/release/vc_redist.x64.exe',
    );

    const learnMoreBtn = screen.getByText(
      'common:diagnostics.acpxVcRedistMissing.learnMoreButton',
    );
    fireEvent.click(learnMoreBtn);
    expect(openExternal).toHaveBeenCalledWith(
      'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist',
    );
  });
});
