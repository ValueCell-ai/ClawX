import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import {
  readAttachmentBinary,
  readBinaryFile,
  readWorkspaceBinary,
  type AttachmentFileRef,
  type WorkspaceFileRef,
} from '@/lib/file-preview-client';
import { cn } from '@/lib/utils';
import { FILE_PREVIEW_MAX_OFFICE_BYTES } from '@shared/file-preview/limits';
import { getFilePreviewTargetIdentity } from './types';

export interface OfficeViewerProps {
  filePath: string;
  fileName?: string;
  attachmentFileRef?: AttachmentFileRef;
  workspaceFileRef?: WorkspaceFileRef;
  onTooLarge?: (size?: number) => void;
  className?: string;
}

type LoadState =
  | { identity: string; status: 'loading' }
  | { identity: string; status: 'tooLarge'; size?: number }
  | { identity: string; status: 'error' }
  | { identity: string; status: 'ready' };

const DOCX_RENDER_OPTIONS = {
  className: 'clawx-docx',
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  renderChanges: false,
  renderComments: false,
  renderAltChunks: false,
  useBase64URL: true,
  experimental: false,
  debug: false,
} as const;

const DOCX_SURFACE_CSS = `
  :host {
    display: block;
    min-height: 100%;
  }

  .docx-preview-body {
    box-sizing: border-box;
    min-height: 100%;
    min-width: 100%;
    padding: 24px;
    background: hsl(var(--surface-input));
    transform-origin: top left;
  }

  .clawx-docx-wrapper {
    background: transparent !important;
    padding: 0 !important;
  }

  section.clawx-docx {
    margin: 0 auto 24px !important;
    background: white;
    color: #111;
    box-shadow: 0 1px 3px rgb(0 0 0 / 12%), 0 12px 32px rgb(0 0 0 / 10%);
  }
`;

export default function DocxViewer({
  filePath,
  fileName,
  attachmentFileRef,
  workspaceFileRef,
  onTooLarge,
  className,
}: OfficeViewerProps) {
  const { t } = useTranslation('chat');
  const loadIdentity = getFilePreviewTargetIdentity({ filePath, attachmentFileRef, workspaceFileRef });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const committedIdentityRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const onTooLargeRef = useRef(onTooLarge);
  const [storedState, setState] = useState<LoadState>({ identity: loadIdentity, status: 'loading' });

  const state: LoadState = storedState.identity === loadIdentity
    ? storedState
    : { identity: loadIdentity, status: 'loading' };

  useLayoutEffect(() => {
    onTooLargeRef.current = onTooLarge;
  }, [onTooLarge]);

  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    committedIdentityRef.current = loadIdentity;

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      if (committedIdentityRef.current === loadIdentity) committedIdentityRef.current = null;
    };
  }, [loadIdentity]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadowRootRef.current = shadowRoot;
    const preventAnchorActivation = (event: Event) => {
      if (event.composedPath().some((target) => target instanceof HTMLAnchorElement)) {
        event.preventDefault();
      }
    };
    shadowRoot.addEventListener('click', preventAnchorActivation, true);
    shadowRoot.addEventListener('auxclick', preventAnchorActivation, true);

    return () => {
      shadowRoot.removeEventListener('click', preventAnchorActivation, true);
      shadowRoot.removeEventListener('auxclick', preventAnchorActivation, true);
      shadowRoot.replaceChildren();
      shadowRootRef.current = null;
    };
  }, []);

  useEffect(() => {
    const generation = generationRef.current;
    let cancelled = false;
    let bytes: Uint8Array | null = null;
    let bodyContainer: HTMLDivElement | null = null;
    let styleContainer: HTMLDivElement | null = null;
    let surfaceStyle: HTMLStyleElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let renderInFlight = false;

    const isCurrent = () => (
      !cancelled
      && generationRef.current === generation
      && committedIdentityRef.current === loadIdentity
    );
    const clearResources = (releaseReferences = false) => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      surfaceStyle?.remove();
      styleContainer?.remove();
      styleContainer?.replaceChildren();
      bodyContainer?.remove();
      bodyContainer?.replaceChildren();
      if (releaseReferences) {
        surfaceStyle = null;
        styleContainer = null;
        bodyContainer = null;
      }
    };

    setState({ identity: loadIdentity, status: 'loading' });

    void (async () => {
      try {
        if (attachmentFileRef && workspaceFileRef) {
          setState({ identity: loadIdentity, status: 'error' });
          return;
        }

        const result = attachmentFileRef
          ? await readAttachmentBinary(attachmentFileRef, FILE_PREVIEW_MAX_OFFICE_BYTES)
          : workspaceFileRef
            ? await readWorkspaceBinary({ ...workspaceFileRef, maxBytes: FILE_PREVIEW_MAX_OFFICE_BYTES })
            : await readBinaryFile(filePath, { maxBytes: FILE_PREVIEW_MAX_OFFICE_BYTES });
        if (!isCurrent()) return;
        if (!result.ok && result.error === 'tooLarge') {
          setState({ identity: loadIdentity, status: 'tooLarge', size: result.size });
          onTooLargeRef.current?.(result.size);
          return;
        }
        if (!result.ok || !result.data || result.data.byteLength === 0) {
          setState({ identity: loadIdentity, status: 'error' });
          return;
        }

        bytes = result.data;
        bodyContainer = document.createElement('div');
        bodyContainer.className = 'docx-preview-body';
        styleContainer = document.createElement('div');
        styleContainer.className = 'docx-preview-styles';

        const { renderAsync } = await import('docx-preview');
        if (!isCurrent() || !bytes) return;
        renderInFlight = true;
        try {
          await renderAsync(bytes, bodyContainer, styleContainer, DOCX_RENDER_OPTIONS);
        } finally {
          renderInFlight = false;
        }
        bytes = null;

        if (!isCurrent()) {
          clearResources(true);
          return;
        }

        const host = hostRef.current;
        const shadowRoot = shadowRootRef.current;
        if (!host || !shadowRoot) {
          clearResources(true);
          return;
        }

        surfaceStyle = document.createElement('style');
        surfaceStyle.textContent = DOCX_SURFACE_CSS;
        shadowRoot.append(styleContainer, surfaceStyle, bodyContainer);

        const updateZoom = () => {
          if (!bodyContainer || !host) return;
          bodyContainer.style.zoom = '1';
          const widestPageWidth = Array.from(
            bodyContainer.querySelectorAll<HTMLElement>('section.clawx-docx'),
          ).reduce((widest, page) => Math.max(widest, page.offsetWidth), 0);
          if (host.clientWidth > 0 && widestPageWidth > 0) {
            bodyContainer.style.zoom = String(Math.min(1, host.clientWidth / widestPageWidth));
          }
        };

        resizeObserver = new ResizeObserver(updateZoom);
        resizeObserver.observe(host);
        updateZoom();
        setState({ identity: loadIdentity, status: 'ready' });
      } catch {
        bytes = null;
        clearResources(true);
        if (isCurrent()) {
          setState({ identity: loadIdentity, status: 'error' });
        }
      } finally {
        bytes = null;
      }
    })();

    return () => {
      cancelled = true;
      bytes = null;
      clearResources(!renderInFlight);
    };
  }, [attachmentFileRef, filePath, loadIdentity, workspaceFileRef]);

  return (
    <div
      data-testid="docx-viewer"
      className={cn('relative h-full min-h-0 overflow-hidden bg-surface-input/35', className)}
    >
      <div
        ref={hostRef}
        data-testid="docx-preview-host"
        aria-label={fileName}
        className="h-full min-h-0 overflow-auto"
      />
      {state.status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-input/35">
          <LoadingSpinner />
        </div>
      )}
      {state.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-input/35 px-6 text-center text-sm text-destructive">
          {t('filePreview.docx.loadFailed', 'Word document failed to load')}
        </div>
      )}
      {state.status === 'tooLarge' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-input/35 px-6 text-center text-sm text-muted-foreground">
          {t('filePreview.errors.tooLarge', 'File too large; preview disabled')}
        </div>
      )}
    </div>
  );
}
