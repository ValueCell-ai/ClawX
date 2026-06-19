export type ClawXStagedFile = {
  fileName: string;
  filePath: string;
  mimeType: string;
};

export function extractClawXStagedFiles(params: Record<string, unknown>): ClawXStagedFile[] {
  const files = params.clawxStagedFiles;
  if (!Array.isArray(files)) return [];

  return files.filter((file): file is ClawXStagedFile => {
    if (!file || typeof file !== 'object') return false;
    const entry = file as Record<string, unknown>;
    return (
      typeof entry.fileName === 'string'
      && typeof entry.filePath === 'string'
      && typeof entry.mimeType === 'string'
    );
  });
}

export function stripClawXAdapterFields<T extends Record<string, unknown>>(
  params: T,
): Omit<T, 'clawxStagedFiles'> {
  const rest: Record<string, unknown> = { ...params };
  delete rest.clawxStagedFiles;
  return rest as Omit<T, 'clawxStagedFiles'>;
}
