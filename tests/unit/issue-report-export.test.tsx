import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueReportExport } from '@/components/settings/IssueReportExport';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import i18n from '@/i18n';
import enSettings from '@shared/i18n/locales/en/settings.json';

const initialChatState = useChatStore.getState();
const initialLanguage = i18n.language;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  useChatStore.setState(initialChatState, true);
  await i18n.changeLanguage(initialLanguage);
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

  it('opens the same export dialog from the sidebar shortcut', () => {
    useChatStore.setState({
      sessions: [],
      sessionLabels: {},
      currentSessionKey: null,
      loadSessions: vi.fn().mockResolvedValue(undefined),
    });

    render(<IssueReportExport trigger="sidebar" sidebarCollapsed />);

    const shortcut = screen.getByTestId('sidebar-issue-report-open');
    expect(shortcut).toHaveAccessibleName(enSettings.issueReport.actionTitle);
    expect(shortcut).not.toHaveTextContent(enSettings.issueReport.actionTitle);
    expect(screen.getByTestId('sidebar-issue-report-icon')).toBeInTheDocument();
    fireEvent.click(shortcut);
    expect(screen.getByTestId('issue-report-dialog')).toBeInTheDocument();
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
