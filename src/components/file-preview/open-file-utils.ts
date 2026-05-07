import { invokeIpc } from '@/lib/api-client';
import { formatFileSize } from './format';

export const DIRECT_OPEN_FALLBACK_EXTS = new Set(['.pdf', '.xls', '.xlsx']);
export const DIRECT_OPEN_FALLBACK_MIN_BYTES = 2 * 1024 * 1024;

export function isDirectOpenFallbackExt(ext?: string | null): boolean {
  return !!ext && DIRECT_OPEN_FALLBACK_EXTS.has(ext.toLowerCase());
}

export function shouldOfferDirectOpenFallback(ext?: string | null, size?: number): boolean {
  return isDirectOpenFallbackExt(ext) && typeof size === 'number' && size > DIRECT_OPEN_FALLBACK_MIN_BYTES;
}

export async function confirmAndOpenFile(params: {
  filePath: string;
  fileName: string;
  size?: number;
  t: (key: string, options?: { defaultValue?: string; [key: string]: unknown }) => string;
}): Promise<boolean> {
  const { filePath, fileName, size, t } = params;
  const sizeLabel = typeof size === 'number' ? formatFileSize(size) : null;
  const detail = [
    t('filePreview.confirmOpen.detail', {
      defaultValue: '该文件将使用系统默认应用打开。',
    }),
    sizeLabel
      ? t('filePreview.confirmOpen.size', {
        defaultValue: '文件大小：{{size}}',
        size: sizeLabel,
      })
      : null,
    filePath,
  ].filter(Boolean).join('\n');

  const result = await invokeIpc<{ response?: number }>('dialog:message', {
    type: 'question',
    buttons: [
      t('filePreview.confirmOpen.cancel', { defaultValue: '取消' }),
      t('filePreview.actions.openDirectly', { defaultValue: '直接打开' }),
    ],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: t('filePreview.confirmOpen.title', { defaultValue: '打开文件' }),
    message: t('filePreview.confirmOpen.message', {
      defaultValue: '确认直接打开「{{fileName}}」？',
      fileName,
    }),
    detail,
  });

  if (result?.response !== 1) return false;

  const openResult = await invokeIpc<string>('shell:openPath', filePath);
  if (openResult) {
    throw new Error(openResult);
  }
  return true;
}
