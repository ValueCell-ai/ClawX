/** Unsent media staged through the Host API, kept in memory with its draft. */
export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  sourceKind: 'path' | 'buffer';
  preview: string | null;
  status: 'staging' | 'ready' | 'error';
  error?: string;
}
