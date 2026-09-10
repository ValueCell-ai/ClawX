import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueReportExport } from '@/components/settings/IssueReportExport';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';

const initialChatState = useChatStore.getState();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useChatStore.setState(initialChatState, true);
});

describe('IssueReportExport', () => {
  it('exports diagnostics when there are no conversations', async () => {
    useChatStore.setState({
      sessions: [],
      sessionLabels: {},
      currentSessionKey: null,
      loadSessions: vi.fn().mockResolvedValue(undefined),
    });
    const exportIssueReport = vi.spyOn(hostApi.diagnostics, 'exportIssueReport').mockResolvedValue({
      success: true,
      path: '/tmp/issue-report.zip',
      includedFiles: ['manifest.json'],
      skippedSessionKeys: [],
    });

    render(<IssueReportExport />);
    fireEvent.click(screen.getByTestId('settings-issue-report-open'));

    expect(screen.getByTestId('issue-report-export')).toBeEnabled();
    fireEvent.click(screen.getByTestId('issue-report-export'));
    await waitFor(() => expect(exportIssueReport).toHaveBeenCalledWith({ sessionKeys: [] }));
  });

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
