import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { buildAttachmentPreviewTarget } from '@/components/file-preview/build-preview-target';
import { attachmentOpenMode } from '@/lib/file-preview-capabilities';
import { extnameOf } from '@/lib/generated-files';
import { hostApi } from '@/lib/host-api';
import { useArtifactPanel } from '@/stores/artifact-panel';

export function AcpMarkdownFileLink({ uri, children }: { uri: string; children: ReactNode }) {
  const { t } = useTranslation('chat');
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const activate = async () => {
    if (pending) return;
    setPending(true);
    let isCurrent = () => mounted.current;
    try {
      // The Chat owner already loads this store. Resolve it on interaction so
      // Markdown-only consumers do not import transport/store initialization.
      const { useAcpChatSessionStore } = await import('@/stores/acp-chat-session');
      if (!isCurrent()) return;
      const { activeSessionKey: sessionKey, generation, loading } = useAcpChatSessionStore.getState();
      if (!sessionKey || generation <= 0 || loading) {
        toast.error(t('acp.attachment.unavailable'));
        return;
      }
      isCurrent = () => {
        const current = useAcpChatSessionStore.getState();
        return mounted.current && current.activeSessionKey === sessionKey && current.generation === generation && !current.loading;
      };
      const result = await hostApi.files.resolveAttachment({ ref: { sessionKey, generation, uri } });
      if (!isCurrent()) return;
      if (!result.ok || result.target.kind !== 'local') {
        toast.error(t('acp.attachment.unavailable'));
        return;
      }
      const mode = attachmentOpenMode({
        ext: extnameOf(result.displayName),
        mimeType: result.mimeType,
        size: result.size,
        target: result.target,
      });
      if (mode === 'preview') {
        useArtifactPanel.getState().openPreview(buildAttachmentPreviewTarget({
          reference: { uri, name: result.displayName },
          access: {
            status: 'available',
            identity: result.identity,
            mimeType: result.mimeType,
            size: result.size,
            target: result.target,
          },
        }));
      } else {
        const opened = await hostApi.files.openAttachment(result.target.ref);
        if (!opened.ok && isCurrent()) toast.error(t('acp.attachment.openFailed'));
      }
    } catch {
      if (isCurrent()) toast.error(t('acp.attachment.openFailed'));
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return (
    <button
      type="button"
      data-testid="acp-markdown-file-link"
      title={uri}
      disabled={pending}
      onClick={() => void activate()}
      className="inline cursor-pointer break-all text-left text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
    >
      {children}
    </button>
  );
}
