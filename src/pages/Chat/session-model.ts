import { useEffect, useRef, useState } from 'react';
import { hostApi } from '@/lib/host-api';
import { useComposerDraftStore } from '@/stores/composer-drafts';
import type { ChatSession } from '@shared/chat/types';

type SessionModel = Awaited<ReturnType<typeof hostApi.sessions.getModel>>;

// A newly mounted composer can revisit a session while its previous write is in flight.
const writes = new Map<string, Promise<SessionModel>>();
const selectionErrors = new Map<string, string>();

export function getSessionModelSelectionError(sessionKey: string) {
  return selectionErrors.get(sessionKey);
}

export async function readSessionModel(sessionKey: string) {
  await writes.get(sessionKey)?.catch(() => {});
  return hostApi.sessions.getModel(sessionKey);
}

async function writeSessionModel(sessionKey: string, modelRef: string | null | undefined, createIfMissing = false, thinkingLevel?: string | null) {
  const previous = writes.get(sessionKey);
  const write = () => createIfMissing || thinkingLevel !== undefined
    ? hostApi.sessions.setModel(sessionKey, modelRef, {
      ...(createIfMissing ? { createIfMissing } : {}),
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    })
    : hostApi.sessions.setModel(sessionKey, modelRef);
  const request = previous
    ? previous.catch(() => {}).then(write)
    : write();
  writes.set(sessionKey, request);
  try {
    return await request;
  } finally {
    if (writes.get(sessionKey) === request) writes.delete(sessionKey);
  }
}

export function applyDraftSessionModel(sessionKey: string, createIfMissing: boolean) {
  const { modelRefs, thinkingLevels } = useComposerDraftStore.getState();
  const pending = modelRefs[sessionKey];
  const level = thinkingLevels[sessionKey];
  if (!pending && !level) return writes.get(sessionKey);
  return writeSessionModel(sessionKey, pending, createIfMissing, level).then((value) => {
    const drafts = useComposerDraftStore.getState();
    if (level && drafts.thinkingLevels[sessionKey] === level) drafts.setThinkingLevel(sessionKey, null);
    if (pending && drafts.modelRefs[sessionKey] === pending) drafts.setModelRef(sessionKey, null);
    return value;
  });
}

export function useSessionModel(
  sessionKey: string,
  session: ChatSession | undefined,
  canRead: boolean,
  sending: boolean,
  agentModelRef: string | null | undefined,
) {
  const local = session?.createdLocally === true;
  const draft = useComposerDraftStore((state) => state.modelRefs[sessionKey]);
  const draftLevel = useComposerDraftStore((state) => state.thinkingLevels[sessionKey]);
  const [draftProfile, setDraftProfile] = useState<{
    sessionKey: string; modelRef: string; thinking: SessionModel['thinking'];
  } | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; value: SessionModel } | null>(null);
  const [writingKey, setWritingKey] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    const request = ++revision.current;
    let cancelled = false;
    if (sessionKey && !local && canRead) {
      void readSessionModel(sessionKey).then((value) => {
        if (!cancelled && revision.current === request) setSnapshot({ key: sessionKey, value });
      }).catch(() => {
        if (!cancelled && revision.current === request) setSnapshot(null);
      });
    }
    return () => { cancelled = true; };
  }, [sessionKey, session?.sessionId, session?.sessionModelRevision, session?.thinkingLevel, agentModelRef, local, canRead, sending, draft, readAttempt]);

  const observed = snapshot?.key === sessionKey ? snapshot.value : undefined;
  const isDraft = local || (!session && observed?.exists === false);
  const draftModel = isDraft ? draft || agentModelRef : null;
  useEffect(() => {
    if (!draftModel || !canRead) return;
    let cancelled = false;
    void hostApi.sessions.getDraftThinking(sessionKey, draftModel).then((thinking) => {
      if (!cancelled) setDraftProfile({ sessionKey, modelRef: draftModel, thinking: thinking ?? undefined });
    }).catch(() => {
      if (!cancelled) setDraftProfile(null);
    });
    return () => { cancelled = true; };
  }, [canRead, draftModel, sessionKey]);

  const select = async (modelRef: string | null | undefined, thinkingLevel?: string | null) => {
    const stage = () => {
      const drafts = useComposerDraftStore.getState();
      if (modelRef !== undefined) {
        selectionErrors.delete(sessionKey);
        drafts.setModelRef(sessionKey, modelRef);
        if (modelRef !== (draft || agentModelRef)) drafts.setThinkingLevel(sessionKey, null);
      } else if (thinkingLevel !== undefined) drafts.setThinkingLevel(sessionKey, thinkingLevel);
    };
    if (local) {
      stage();
      return;
    }
    const request = ++revision.current;
    setWritingKey(sessionKey);
    try {
      // An Agent's main session can exist even when the sidebar omits it.
      // Stage a first-prompt choice only if the Gateway confirms the row is absent.
      if (!session) {
        const observed = snapshot?.key === sessionKey ? snapshot.value : await readSessionModel(sessionKey);
        if (observed.exists === false) {
          stage();
          if (revision.current === request) setSnapshot({ key: sessionKey, value: observed });
          return;
        }
      }
      const value = await writeSessionModel(sessionKey, modelRef, false, thinkingLevel);
      // A previous failed first send may still have a pending model on this session.
      const drafts = useComposerDraftStore.getState();
      if (modelRef !== undefined) {
        selectionErrors.delete(sessionKey);
        drafts.setModelRef(sessionKey, null);
      }
      drafts.setThinkingLevel(sessionKey, null);
      if (revision.current === request) {
        setSnapshot({ key: sessionKey, value });
        if (value.thinking || observed?.thinking) setReadAttempt((n) => n + 1);
      }
    } catch (error) {
      if (modelRef !== undefined) selectionErrors.set(sessionKey, String(error));
      throw error;
    } finally {
      setWritingKey((key) => key === sessionKey ? null : key);
    }
  };
  let value: SessionModel | undefined;
  if (draft || local) value = { modelRef: draft ?? null };
  else if (snapshot?.key === sessionKey) value = snapshot.value;
  let thinking = value?.thinking;
  if (isDraft) {
    const profile = draftProfile?.modelRef === draftModel && draftProfile?.sessionKey === sessionKey
      ? draftProfile.thinking : undefined;
    thinking = profile && { ...profile, selectedLevel: draftLevel };
  }
  return {
    value,
    thinking,
    select,
    failed: selectionErrors.has(sessionKey),
    writing: writingKey === sessionKey,
    refresh: () => setReadAttempt((n) => n + 1),
  };
}
