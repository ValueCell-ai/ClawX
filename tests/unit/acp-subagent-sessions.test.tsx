import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AcpSubagentSessions,
  type AcpSubagentSession,
} from '@/pages/Chat/AcpSubagentSessions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'acp.subagentSessions.count': 'Dispatched {{count}} subagents',
        'acp.subagentSessions.expand': 'Expand subagent sessions',
        'acp.subagentSessions.collapse': 'Collapse subagent sessions',
        'acp.subagentSessions.toggle': '{{action}}, {{count}}',
        'acp.subagentSessions.panel': 'Subagent sessions',
        'acp.subagentSessions.open': 'Open subagent {{title}}',
        'acp.subagentSessions.busy': 'Running',
        'acp.subagentSessions.settled': 'Settled',
        'acp.subagentSessions.aggregateStatus': 'Subagents: {{status}}',
        'acp.subagentSessions.rowStatus': '{{title}}: {{status}}',
      };
      return (labels[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(values?.[name] ?? ''));
    },
  }),
}));

const sessions: AcpSubagentSession[] = [
  {
    sessionKey: 'agent:main:subagent:research',
    title: '[Subagent Context] Research API behavior',
    busy: true,
  },
  {
    sessionKey: 'agent:main:subagent:tests',
    title: 'Verify focused tests',
    busy: false,
  },
];

describe('AcpSubagentSessions', () => {
  it('renders nothing when there are no direct child sessions', () => {
    render(
      <AcpSubagentSessions
        sessions={[]}
        sessionKey="agent:main:empty"
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('acp-subagent-sessions-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acp-subagent-sessions-panel')).not.toBeInTheDocument();
  });

  it('starts collapsed with the localized action, count, and aggregate busy semantics', () => {
    render(
      <AcpSubagentSessions
        sessions={sessions}
        sessionKey="agent:main:parent"
        onSelectSession={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId('acp-subagent-sessions-toggle');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName('Expand subagent sessions, Dispatched 2 subagents');
    expect(toggle).toHaveAccessibleDescription('Subagents: Running');
    expect(toggle).toHaveTextContent('Dispatched 2 subagents');
    expect(toggle.querySelector('.lucide-loader-circle')).toHaveClass(
      'animate-spin',
      'motion-reduce:animate-none',
      'text-blue-700',
      'dark:text-blue-400',
    );
    const aggregateStatus = screen.getByTestId('acp-subagent-sessions-status');
    expect(aggregateStatus).toHaveAttribute('role', 'status');
    expect(aggregateStatus).toHaveAttribute('aria-live', 'polite');
    expect(aggregateStatus).toHaveAttribute('aria-atomic', 'true');
    expect(aggregateStatus).toHaveTextContent('Subagents: Running');
    expect(screen.queryByTestId('acp-subagent-sessions-panel')).not.toBeInTheDocument();
  });

  it('uses native button activation semantics and exposes an accessible scrolling panel', () => {
    render(
      <AcpSubagentSessions
        sessions={sessions}
        sessionKey="agent:main:keyboard"
        onSelectSession={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Expand subagent sessions, Dispatched 2 subagents' });
    expect(toggle).toHaveAttribute('type', 'button');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Collapse subagent sessions, Dispatched 2 subagents');
    const panel = screen.getByTestId('acp-subagent-sessions-panel');
    expect(panel).toHaveAttribute('aria-label', 'Subagent sessions');
    expect(panel).toHaveClass('absolute', 'bottom-full', 'right-0', 'max-h-48', 'overflow-y-auto', 'bg-surface-modal');
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
  });

  it('renders ordered drill-down rows with cleaned titles and accessible per-session status', () => {
    const onSelectSession = vi.fn();
    render(
      <AcpSubagentSessions
        sessions={sessions}
        sessionKey="agent:main:rows"
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getByTestId('acp-subagent-sessions-toggle'));

    const rows = screen.getAllByTestId('acp-subagent-session-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Research API behavior',
      'Verify focused tests',
    ]);
    expect(rows[0].querySelector('.lucide-loader-circle')).toHaveClass(
      'animate-spin',
      'motion-reduce:animate-none',
      'text-blue-700',
      'dark:text-blue-400',
    );
    expect(rows[1].querySelector('.lucide-bot')).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('type', 'button');
    expect(rows[0]).toHaveAccessibleName('Open subagent Research API behavior');
    expect(rows[0]).toHaveAccessibleDescription('Research API behavior: Running');
    expect(rows[1]).toHaveAccessibleDescription('Verify focused tests: Settled');
    expect(rows[0].querySelector('span')).toHaveClass('break-words');
    const rowStatuses = screen.getAllByTestId('acp-subagent-session-status');
    expect(rowStatuses.map((status) => status.textContent)).toEqual([
      'Research API behavior: Running',
      'Verify focused tests: Settled',
    ]);
    expect(rowStatuses.every((status) => status.getAttribute('role') === 'status')).toBe(true);
    expect(rowStatuses.every((status) => status.getAttribute('aria-live') === 'polite')).toBe(true);
    expect(rowStatuses.every((status) => status.getAttribute('aria-atomic') === 'true')).toBe(true);

    fireEvent.click(rows[0]);

    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith('agent:main:subagent:research');
  });

  it('shows the idle aggregate icon when no child is busy', () => {
    render(
      <AcpSubagentSessions
        sessions={sessions.map((session) => ({ ...session, busy: false }))}
        sessionKey="agent:main:idle"
        onSelectSession={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId('acp-subagent-sessions-toggle');
    expect(toggle.querySelector('.lucide-bot')).toBeInTheDocument();
    expect(toggle.querySelector('.lucide-loader-circle')).not.toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription('Subagents: Settled');
    expect(screen.getByTestId('acp-subagent-sessions-status')).toHaveTextContent('Subagents: Settled');
  });

  it('keeps an open panel expanded through live title, status, order, and count updates', () => {
    const { rerender } = render(
      <AcpSubagentSessions
        sessions={sessions}
        sessionKey="agent:main:stable-parent"
        onSelectSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('acp-subagent-sessions-toggle'));

    rerender(
      <AcpSubagentSessions
        sessions={[
          { ...sessions[1], title: 'Tests completed', busy: false },
          { ...sessions[0], title: 'Research completed', busy: false },
          { sessionKey: 'agent:main:subagent:review', title: 'Review changes', busy: false },
        ]}
        sessionKey="agent:main:stable-parent"
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByTestId('acp-subagent-sessions-panel')).toBeInTheDocument();
    const toggle = screen.getByTestId('acp-subagent-sessions-toggle');
    expect(toggle).toHaveTextContent('Dispatched 3 subagents');
    expect(toggle).toHaveAccessibleName('Collapse subagent sessions, Dispatched 3 subagents');
    expect(toggle).toHaveAccessibleDescription('Subagents: Settled');
    expect(toggle.querySelector('.lucide-bot')).toBeInTheDocument();
    expect(toggle.querySelector('.lucide-loader-circle')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-subagent-sessions-status')).toHaveTextContent('Subagents: Settled');
    const rows = screen.getAllByTestId('acp-subagent-session-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Tests completed',
      'Research completed',
      'Review changes',
    ]);
    expect(rows.every((row) => row.getAttribute('aria-describedby'))).toBe(true);
    expect(rows.every((row) => row.querySelector('.lucide-bot'))).toBe(true);
    expect(screen.getAllByTestId('acp-subagent-session-status').map((status) => status.textContent)).toEqual([
      'Tests completed: Settled',
      'Research completed: Settled',
      'Review changes: Settled',
    ]);
  });

  it('closes an open panel when the selected parent/session identity changes', () => {
    const { rerender } = render(
      <AcpSubagentSessions
        sessions={sessions}
        sessionKey="agent:main:first-parent"
        onSelectSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('acp-subagent-sessions-toggle'));
    expect(screen.getByTestId('acp-subagent-sessions-panel')).toBeInTheDocument();

    rerender(
      <AcpSubagentSessions
        sessions={sessions}
        sessionKey="agent:main:second-parent"
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('acp-subagent-sessions-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-subagent-sessions-toggle')).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <AcpSubagentSessions
        sessions={sessions}
        sessionKey="agent:main:first-parent"
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('acp-subagent-sessions-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-subagent-sessions-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});
