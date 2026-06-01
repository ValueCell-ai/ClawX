import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '@/stores/chat';

export function useNewChatAction(): () => void {
  const navigate = useNavigate();
  const newSession = useChatStore((state) => state.newSession);

  return useCallback(() => {
    const { messages } = useChatStore.getState();
    if (messages.length > 0) newSession();
    navigate('/');
  }, [navigate, newSession]);
}
