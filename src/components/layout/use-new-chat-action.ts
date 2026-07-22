import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveEffectiveWorkspace } from '@/lib/workspace-context';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';

export function useNewChatAction(): () => void {
  const navigate = useNavigate();
  const newSession = useChatStore((state) => state.newSession);
  const setChatWorkspacePath = useSettingsStore((state) => state.setChatWorkspacePath);

  return useCallback(() => {
    const { currentSessionKey, sessions } = useChatStore.getState();
    const selectedSession = sessions.find((session) => session.key === currentSessionKey);

    // Start the draft in the selected conversation's effective workspace while
    // keeping the workspace picker editable until the first message creates it.
    if (selectedSession) {
      const selectedWorkspacePath = resolveEffectiveWorkspace({
        session: selectedSession,
        globalWorkspace: useSettingsStore.getState().chatWorkspacePath,
      }).cwd;
      setChatWorkspacePath(selectedWorkspacePath);
    }

    newSession();
    navigate('/');
  }, [navigate, newSession, setChatWorkspacePath]);
}
