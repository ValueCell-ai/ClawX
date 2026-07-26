const ACP_WORKING_DIRECTORY_PREFIX = /^\[Working directory: [^\r\n]*\](?:\r?\n){0,2}/
const ACP_WORKING_DIRECTORY_TRUNCATED_TITLE = /^\[Working directory: [^\r\n]*\]…$/

export function stripAcpWorkingDirectoryPrefix(text: string): string {
  return text.replace(ACP_WORKING_DIRECTORY_PREFIX, '')
}

export function isAcpWorkingDirectoryTruncatedTitle(text: string): boolean {
  return ACP_WORKING_DIRECTORY_TRUNCATED_TITLE.test(text.trim())
}
