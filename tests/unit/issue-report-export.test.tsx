import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueReportExport } from '@/components/settings/IssueReportExport';
import { useChatStore } from '@/stores/chat';

const initialChatState = useChatStore.getState();

afterEach(() => {
  cleanup();
  useChatStore.setState(initialChatState, true);
});

describe('IssueReportExport', () => {
  it('keeps retained native subagent transcripts selectable for export', () => {
    const parentKey = 'agent:main:main';
    const childKey = 'agent:main:subagent:export-child';
    useChatStore.setState({
      sessions: [
        { key: parentKey, displayName: 'Parent conversation', updatedAt: 2 },
        { key: childKey, displayName: 'Child transcript', updatedAt: 1 },
      ],
      sessionLabels: {},
      currentSessionKey: parentKey,
      loadSessions: vi.fn().mockResolvedValue(undefined),
    });

    render(<IssueReportExport />);
    fireEvent.click(screen.getByTestId('settings-issue-report-open'));

    expect(screen.getByTestId(`issue-report-session-${parentKey}`)).toBeInTheDocument();
    expect(screen.getByTestId(`issue-report-session-${childKey}`)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^issue-report-session-/)).toHaveLength(2);
  });
});
