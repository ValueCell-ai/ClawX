const ACP_WORKING_DIRECTORY_PREFIX = /^\[Working directory: [^\r\n]*\](?:\r?\n){0,2}/
const ACP_WORKING_DIRECTORY_TRUNCATED_TITLE = /^\[Working directory: [^\r\n]*\]…$/
const OPENCLAW_SESSION_ID_FALLBACK_TITLE = /^([0-9a-f]{8}) \((\d{4}-\d{2}-\d{2})\)$/i

export type SessionTitleSource = {
  key: string
  sessionId?: string
  label?: string
  derivedTitle?: string
  displayName?: string
}

export function stripAcpWorkingDirectoryPrefix(text: string): string {
  return text.replace(ACP_WORKING_DIRECTORY_PREFIX, '')
}

export function isAcpWorkingDirectoryTruncatedTitle(text: string): boolean {
  return ACP_WORKING_DIRECTORY_TRUNCATED_TITLE.test(text.trim())
}

export function isOpenClawSessionIdFallbackTitle(
  text: string,
  sessionId: string | null | undefined,
): boolean {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim().toLowerCase() : ''
  if (!normalizedSessionId) return false
  const match = text.trim().match(OPENCLAW_SESSION_ID_FALLBACK_TITLE)
  return Boolean(match && normalizedSessionId.startsWith(match[1]!.toLowerCase()))
}

/** Resolve the same human-readable title used for a session everywhere in the UI. */
export function getSessionDisplayTitle(
  session: SessionTitleSource,
  sessionLabels: Record<string, string> = {},
): string {
  const candidates = [
    sessionLabels[session.key],
    session.label,
    session.derivedTitle,
    session.displayName,
  ]
  return candidates.find((candidate) => (
    candidate?.trim()
    && !isOpenClawSessionIdFallbackTitle(candidate, session.sessionId)
  ))?.trim() ?? session.key
}
