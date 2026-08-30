import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AcpSessionPlan } from '@/pages/Chat/AcpSessionPlan';
import type { AcpCurrentPlan } from '@/lib/acp/current-plan';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'acp.pending': 'Pending',
        'acp.running': 'Running',
        'acp.completed': 'Completed',
        'acp.sessionPlan.progress': '{{completed}} / {{total}}',
        'acp.sessionPlan.expand': 'Expand plan',
        'acp.sessionPlan.collapse': 'Collapse plan',
        'acp.sessionPlan.tasks': 'Plan tasks',
      };
      return (labels[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(values?.[name] ?? ''));
    },
  }),
}));

const plan: AcpCurrentPlan = {
  completedCount: 1,
  totalCount: 3,
  steps: [
    { step: 'Inspect the current implementation', status: 'completed' },
    { step: 'Implement the read-only composer indicator with text that must wrap rather than truncate', status: 'in_progress' },
    { step: 'Verify the focused tests', status: 'pending' },
  ],
};

describe('AcpSessionPlan', () => {
  it('renders nothing without a current plan', () => {
    render(<AcpSessionPlan plan={null} sessionKey="agent:main:empty" />);

    expect(screen.queryByTestId('acp-session-plan-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acp-session-plan-panel')).not.toBeInTheDocument();
  });

  it('starts collapsed with localized progress and expands from the semantic toggle', () => {
    render(<AcpSessionPlan plan={plan} sessionKey="agent:main:plan" />);

    const toggle = screen.getByTestId('acp-session-plan-toggle');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-label', 'Expand plan');
    expect(toggle).toHaveTextContent('1 / 3');
    expect(toggle.querySelector('.lucide-list-checks')).toBeInTheDocument();
    expect(screen.queryByTestId('acp-session-plan-panel')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-label', 'Collapse plan');
    expect(screen.getByTestId('acp-session-plan-panel')).toHaveAttribute('aria-label', 'Plan tasks');
  });

  it('uses native button keyboard semantics to toggle the panel', () => {
    render(<AcpSessionPlan plan={plan} sessionKey="agent:main:keyboard" />);

    const toggle = screen.getByRole('button', { name: 'Expand plan' });
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'Enter', code: 'Enter' });
    fireEvent.click(toggle); // Browsers dispatch this click for native button keyboard activation.

    expect(screen.getByTestId('acp-session-plan-panel')).toBeInTheDocument();
  });

  it('shows ordered, wrapping-capable status rows without mutation controls', () => {
    render(<AcpSessionPlan plan={plan} sessionKey="agent:main:steps" />);
    fireEvent.click(screen.getByTestId('acp-session-plan-toggle'));

    const panel = screen.getByTestId('acp-session-plan-panel');
    const steps = screen.getAllByTestId('acp-session-plan-step');
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining('Inspect the current implementation'),
      expect.stringContaining('Implement the read-only composer indicator'),
      expect.stringContaining('Verify the focused tests'),
    ]);
    expect(steps[0]).toHaveClass('text-green-700', 'dark:text-green-400');
    expect(steps[0].querySelector('.lucide-circle-check')).toBeInTheDocument();
    expect(steps[1].querySelector('.lucide-circle-ellipsis')).toBeInTheDocument();
    expect(steps[2].querySelector('.lucide-circle')).toBeInTheDocument();
    expect(steps[1]).toHaveClass('text-muted-foreground');
    expect(steps[1]).not.toHaveClass('text-blue-700', 'animate-spin');
    expect(steps[1].querySelector('span')).toHaveClass('break-words');
    expect(steps[0].querySelector('svg')).toHaveClass('translate-y-0.5');
    expect(steps[1].querySelector('svg')).toHaveClass('translate-y-0.5');
    expect(steps[2].querySelector('svg')).toHaveClass('translate-y-0.5');
    expect(steps[0]).not.toHaveTextContent('Completed');
    expect(steps[1]).not.toHaveTextContent('Running');
    expect(steps[2]).not.toHaveTextContent('Pending');
    expect(panel).toHaveClass('max-h-48', 'overflow-y-auto');
    expect(panel.querySelectorAll('button, input[type="checkbox"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument();
  });

  it('keeps an expanded panel open for an equivalent re-projected plan in the same session', () => {
    const { rerender } = render(<AcpSessionPlan plan={plan} sessionKey="agent:main:one" />);
    fireEvent.click(screen.getByTestId('acp-session-plan-toggle'));

    rerender(<AcpSessionPlan plan={{ ...plan, steps: plan.steps.map((step) => ({ ...step })) }} sessionKey="agent:main:one" />);

    expect(screen.getByTestId('acp-session-plan-panel')).toBeInTheDocument();
  });

  it('closes an expanded panel when its plan or session identity changes', () => {
    const { rerender } = render(<AcpSessionPlan plan={plan} sessionKey="agent:main:one" />);
    const toggle = screen.getByTestId('acp-session-plan-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('acp-session-plan-panel')).toBeInTheDocument();

    rerender(<AcpSessionPlan plan={{ ...plan, completedCount: 2 }} sessionKey="agent:main:one" />);
    expect(screen.queryByTestId('acp-session-plan-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('acp-session-plan-toggle'));
    rerender(<AcpSessionPlan plan={plan} sessionKey="agent:main:two" />);
    expect(screen.queryByTestId('acp-session-plan-panel')).not.toBeInTheDocument();
  });
});
