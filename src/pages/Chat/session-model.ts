import { useEffect, useRef, useState } from 'react';
import { hostApi } from '@/lib/host-api';
import { useComposerDraftStore } from '@/stores/composer-drafts';
import type { ChatSession } from '@shared/chat/types';

type SessionModel = Awaited<ReturnType<typeof hostApi.sessions.getModel>>;

// A newly mounted composer can revisit a session while its previous write is in flight.
const writes = new Map<string, Promise<SessionModel>>();

export async function readSessionModel(sessionKey: string) {
  await writes.get(sessionKey)?.catch(() => {});
  return hostApi.sessions.getModel(sessionKey);
}

async function writeSessionModel(sessionKey: string, modelRef: string | null, createIfMissing = false) {
  const previous = writes.get(sessionKey);
  const write = () => createIfMissing
    ? hostApi.sessions.setModel(sessionKey, modelRef, { createIfMissing: true })
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
  const { modelRefs, setModelRef } = useComposerDraftStore.getState();
  const pending = modelRefs[sessionKey];
  if (!pending) return writes.get(sessionKey);
  return writeSessionModel(sessionKey, pending, createIfMissing).then((value) => {
    if (useComposerDraftStore.getState().modelRefs[sessionKey] === pending) setModelRef(sessionKey, null);
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
  const [snapshot, setSnapshot] = useState<{ key: string; value: SessionModel } | null>(null);
  const [writingKey, setWritingKey] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    const request = ++revision.current;
    let cancelled = false;
    if (!local && canRead) {
      void readSessionModel(sessionKey).then((value) => {
        if (!cancelled && revision.current === request) setSnapshot({ key: sessionKey, value });
      }).catch(() => {
        if (!cancelled && revision.current === request) setSnapshot(null);
      });
    }
    return () => { cancelled = true; };
  }, [sessionKey, session?.sessionId, session?.sessionModelRevision, agentModelRef, local, canRead, sending, draft, readAttempt]);

  const select = async (modelRef: string | null) => {
    if (local) {
      useComposerDraftStore.getState().setModelRef(sessionKey, modelRef);
      return;
    }
    const request = ++revision.current;
    setWritingKey(sessionKey);
    try {
      const value = await writeSessionModel(sessionKey, modelRef);
      // A previous failed first send may still have a pending model on this session.
      useComposerDraftStore.getState().setModelRef(sessionKey, null);
      if (revision.current === request) setSnapshot({ key: sessionKey, value });
    } finally {
      setWritingKey((key) => key === sessionKey ? null : key);
    }
  };
  let value: SessionModel | undefined;
  if (draft || local) value = { modelRef: draft ?? null };
  else if (snapshot?.key === sessionKey) value = snapshot.value;
  return { value, select, writing: writingKey === sessionKey, refresh: () => setReadAttempt((n) => n + 1) };
}
