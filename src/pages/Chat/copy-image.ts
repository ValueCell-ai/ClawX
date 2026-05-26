import { readBinaryFile } from '@/lib/api-client';

export interface ImageCopyTarget {
  filePath?: string;
  preview?: string | null;
  mimeType?: string;
  base64?: string;
}

function blobFromBytes(data: Uint8Array, mimeType: string): Blob {
  const copy = new Uint8Array(data);
  return new Blob([copy], { type: mimeType });
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob | null> {
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

async function writeImageBlob(blob: Blob, fallbackMimeType: string): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  const type = blob.type || fallbackMimeType;
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
  return true;
}

export async function copyImageToClipboard(target: ImageCopyTarget): Promise<boolean> {
  const mimeType = target.mimeType?.startsWith('image/') ? target.mimeType : 'image/png';

  if (target.base64) {
    const blob = await blobFromDataUrl(`data:${mimeType};base64,${target.base64}`);
    return blob ? writeImageBlob(blob, mimeType) : false;
  }

  if (target.preview?.startsWith('data:')) {
    const blob = await blobFromDataUrl(target.preview);
    return blob ? writeImageBlob(blob, mimeType) : false;
  }

  if (target.filePath) {
    const result = await readBinaryFile(target.filePath);
    if (!result.ok || !result.data) return false;
    return writeImageBlob(blobFromBytes(result.data, result.mimeType || mimeType), mimeType);
  }

  return false;
}
