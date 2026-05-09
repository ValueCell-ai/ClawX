import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ExecutionGraphCard } from '@/pages/Chat/ExecutionGraphCard';
import type { TaskStep } from '@/pages/Chat/task-visualization';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'executionGraph.title') return 'Execution Graph';
      if (key === 'executionGraph.collapseAction') return 'Collapse';
      if (key === 'executionGraph.collapsedSummary') {
        return `collapsed ${String(params?.toolCount ?? '')} ${String(params?.processCount ?? '')}`.trim();
      }
      if (key === 'executionGraph.agentRun') return `${String(params?.agent ?? '')} execution`;
      if (key === 'executionGraph.thinkingLabel') return 'Thinking';
      // Use the actual zh string here so a regression that drops
      // whitespace-nowrap would let "分支" line-break in narrow flex rows.
      if (key === 'executionGraph.branchLabel') return '分支';
      if (key.startsWith('taskPanel.stepStatus.')) {
        return key.split('.').at(-1) ?? key;
      }
      return key;
    },
  }),
}));

// Step rendered as a depth>1 child of a subagent run, exercising both the
// depth-driven branch badge and the status pill that share the same span
// styles in `ExecutionGraphCard`.
const branchStep: TaskStep = {
  id: 'sub-exec-1',
  label: 'exec',
  kind: 'tool',
  status: 'running',
  depth: 2,
  parentId: 'sub-root',
  detail: '{ "command": "openclaw gateway start", "yieldMs": 10000, "timeout": 60 }',
};

describe('ExecutionGraphCard branch badge', () => {
  it('renders the localized branch label without intra-badge wrapping', () => {
    render(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[branchStep]}
        active
        expanded
      />,
    );

    const branchBadge = screen.getByText('分支');
    expect(branchBadge.tagName.toLowerCase()).toBe('span');
    // CJK strings can break between any two glyphs under flex shrink, which
    // visually stacks "分" / "支" on two lines. Both classes together keep the
    // pill on one row regardless of locale or container width.
    expect(branchBadge.className).toContain('whitespace-nowrap');
    expect(branchBadge.className).toContain('shrink-0');
  });

  it('applies the same wrap-safe classes to the visible status pill', () => {
    // Tool steps with status="error" render the status pill (running shows
    // dots and completed hides the pill on tool rows).
    const erroredToolStep: TaskStep = {
      id: 'sub-exec-1',
      label: 'exec',
      kind: 'tool',
      status: 'error',
      depth: 1,
      detail: '{ "command": "openclaw gateway start" }',
    };

    render(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[erroredToolStep]}
        active
        expanded
      />,
    );

    const statusPill = screen.getByText('error');
    expect(statusPill.className).toContain('whitespace-nowrap');
    expect(statusPill.className).toContain('shrink-0');
  });
});
