import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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

describe('ExecutionGraphCard subagent (system) row', () => {
  // Subagent branch root produced by Chat/index.tsx:
  // { kind: 'system', label: '<agent> subagent', detail: '<sessionKey>' }.
  // It must render with the same flat row style as a tool call, NOT the old
  // bordered-card layout that put the session key on a second visible line.
  const subagentStep: TaskStep = {
    id: 'subagent:08efe821',
    label: 'main subagent',
    kind: 'system',
    status: 'completed',
    detail: 'agent:main:subagent:08efe821-2717-4395-b3d7-a8f50928155f',
    depth: 1,
    parentId: 'agent-run',
  };

  it('uses the flat tool-style container without the rounded-card chrome', () => {
    const { container } = render(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[subagentStep]}
        active={false}
        expanded
      />,
    );

    const stepRow = container.querySelector('[data-testid="chat-execution-step"]');
    expect(stepRow).not.toBeNull();
    const detailContainer = stepRow!.querySelector(':scope > div:nth-of-type(2)');
    expect(detailContainer).not.toBeNull();
    const className = detailContainer!.className;
    expect(className).toContain('px-0');
    expect(className).toContain('py-0');
    expect(className).not.toContain('rounded-xl');
    expect(className).not.toContain('border-black/10');
  });

  it('renders the subagent session key inline as a single truncated preview', () => {
    render(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[subagentStep]}
        active={false}
        expanded
      />,
    );

    const preview = screen.getByText(subagentStep.detail!);
    expect(preview.tagName.toLowerCase()).toBe('p');
    expect(preview.className).toContain('truncate');
    // The label is the bold title sibling of the preview.
    const titleNode = screen.getByText('main subagent');
    expect(titleNode.className).toContain('font-medium');
    expect(preview.parentElement).toBe(titleNode.parentElement);
  });

  it('omits the redundant "completed" status pill for finished subagent rows', () => {
    render(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[subagentStep]}
        active={false}
        expanded
      />,
    );

    expect(screen.queryByText('completed')).toBeNull();
  });

  it('expands to a code block when the row is clicked', () => {
    const { container } = render(
      <ExecutionGraphCard
        agentLabel="main"
        steps={[subagentStep]}
        active={false}
        expanded
      />,
    );

    expect(container.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByText('main subagent'));
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(subagentStep.detail);
  });
});
