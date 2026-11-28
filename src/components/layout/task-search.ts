import type { ChatSession } from '@/stores/chat';
import { getSessionDisplayTitle } from '@shared/chat/session-title';

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** Presentation-only metadata search: callers supply the eligible full catalog. */
export function matchesTaskSearch(
  query: string,
  session: ChatSession,
  labels: Record<string, string>,
  assistantName: string,
  workspaceLabel: string,
  workspacePath: string,
): boolean {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = normalize([
    getSessionDisplayTitle(session, labels), assistantName, workspaceLabel, workspacePath, session.workspacePath ?? '',
  ].join(' '));
  return words.every((word) => text.includes(word));
}
