/**
 * GatewayDiagnosticsBanner
 *
 * Renders an actionable alert above the chat input when the Gateway startup
 * classifier detects a known actionable failure (see
 * GatewayStartupDiagnosticCode in `src/types/gateway.ts`).
 *
 * Currently handles:
 *   - ACPX_VC_REDIST_MISSING (Windows MSVC Redistributable missing, which
 *     crashes the bundled codex ACP adapter and blocks chat.history).
 *     Tracked in ValueCell-ai/ClawX#884.
 */
import type { ReactElement } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';
import type {
  GatewayStartupDiagnosticCode,
  GatewayStartupDiagnosticSnapshot,
} from '@/types/gateway';

// Microsoft's official stable aka.ms redirect to the latest x64 VC++
// 2015–2022 Redistributable.  Microsoft guarantees this URL is kept in sync
// with the latest redistributable release.
//
// ARM64 users need `vc_redist.arm64.exe` and 32-bit users need
// `vc_redist.x86.exe`; we link to a page that lists all variants so the
// user can pick the right one, with the x64 link as the primary CTA
// because ~99% of modern Windows desktops are x64.
const VC_REDIST_X64_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const VC_REDIST_INFO_URL =
  'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';

type DiagnosticCopy = {
  titleKey: string;
  bodyKey: string;
  downloadKey: string;
  learnMoreKey: string;
  downloadUrl: string;
  learnMoreUrl: string;
};

const COPY: Record<GatewayStartupDiagnosticCode, DiagnosticCopy> = {
  ACPX_VC_REDIST_MISSING: {
    titleKey: 'common:diagnostics.acpxVcRedistMissing.title',
    bodyKey: 'common:diagnostics.acpxVcRedistMissing.body',
    downloadKey: 'common:diagnostics.acpxVcRedistMissing.downloadButton',
    learnMoreKey: 'common:diagnostics.acpxVcRedistMissing.learnMoreButton',
    downloadUrl: VC_REDIST_X64_URL,
    learnMoreUrl: VC_REDIST_INFO_URL,
  },
};

function openUrl(url: string): void {
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  if (electron?.openExternal) {
    void electron.openExternal(url);
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export interface GatewayDiagnosticsBannerProps {
  /** Extra class names applied to the banner root. */
  className?: string;
}

/**
 * Render one banner per active diagnostic.  If no active diagnostic matches
 * our known set, renders nothing.
 */
export function GatewayDiagnosticsBanner({
  className,
}: GatewayDiagnosticsBannerProps): ReactElement | null {
  const activeDiagnostics = useGatewayStore((s) => s.status.activeDiagnostics);
  const { t } = useTranslation(['common']);

  if (!activeDiagnostics || activeDiagnostics.length === 0) return null;

  const known = activeDiagnostics.filter(
    (d): d is GatewayStartupDiagnosticSnapshot & { code: GatewayStartupDiagnosticCode } =>
      d.code in COPY,
  );

  if (known.length === 0) return null;

  return (
    <div
      className={className}
      role="alert"
      data-testid="gateway-diagnostics-banner"
    >
      {known.map((diagnostic) => {
        const copy = COPY[diagnostic.code];
        return (
          <div
            key={diagnostic.code}
            data-testid={`gateway-diagnostic-${diagnostic.code}`}
            className="mx-4 my-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="font-medium leading-5">{t(copy.titleKey)}</p>
                <p className="mt-1 text-sm leading-5 text-amber-900/90 dark:text-amber-100/90">
                  {t(copy.bodyKey)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => openUrl(copy.downloadUrl)}
                  >
                    {t(copy.downloadKey)}
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openUrl(copy.learnMoreUrl)}
                  >
                    {t(copy.learnMoreKey)}
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default GatewayDiagnosticsBanner;
