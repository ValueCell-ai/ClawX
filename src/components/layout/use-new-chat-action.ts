import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '@/stores/chat';

export function useNewChatAction(): () => void {
  const navigate = useNavigate();
  const newSession = useChatStore((state) => state.newSession);

  return useCallback(() => {
    newSession();
    navigate('/');
  }, [navigate, newSession]);
}
