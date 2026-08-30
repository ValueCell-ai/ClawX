import { describe, expect, it } from 'vitest';
import { getCurrentAcpPlan } from '@/lib/acp/current-plan';
import { createEmptyAcpTimeline } from '@/lib/acp/reducer';
import type { AcpTimelineSnapshot, ToolCallItem } from '@/lib/acp/timeline-types';

type PlanInput = {
  plan: Array<{ step: string; status: 'pending' | 'in_progress' | 'completed' }>;
};

function planCall(
  id: string,
  input: unknown,
  status: ToolCallItem['status'] = 'completed',
  title = 'update_plan: session plan',
): ToolCallItem {
  return {
    kind: 'tool-call',
    id,
    toolCallId: id,
    title,
    status,
    input,
    outputParts: [],
    locations: [],
  };
}

function snapshotWith(...items: ToolCallItem[]): AcpTimelineSnapshot {
  return {
    ...createEmptyAcpTimeline('agent:main:session-1', 1),
    itemOrder: items.map((item) => item.id),
    itemsById: Object.fromEntries(items.map((item) => [item.id, item])),
  };
}

const initialPlan: PlanInput = {
  plan: [
    { step: 'Inspect the session', status: 'completed' },
    { step: 'Project the current plan', status: 'in_progress' },
    { step: 'Render the indicator', status: 'pending' },
  ],
};

describe('getCurrentAcpPlan', () => {
  it('projects ordered completed, in-progress, and pending steps with counts', () => {
    expect(getCurrentAcpPlan(snapshotWith(planCall('initial', initialPlan)))).toEqual({
      steps: initialPlan.plan,
      completedCount: 1,
      totalCount: 3,
    });
  });

  it('selects the newest valid plan call', () => {
    const olderPlan: PlanInput = { plan: [{ step: 'Older step', status: 'completed' }] };
    const newerPlan: PlanInput = { plan: [{ step: 'Newer step', status: 'pending' }] };

    expect(getCurrentAcpPlan(snapshotWith(
      planCall('older', olderPlan),
      planCall('newer', newerPlan),
    ))).toEqual({
      steps: newerPlan.plan,
      completedCount: 0,
      totalCount: 1,
    });
  });

  it('shows a valid running plan update immediately', () => {
    expect(getCurrentAcpPlan(snapshotWith(
      planCall('running', initialPlan, 'running'),
    ))).toMatchObject({ steps: initialPlan.plan, completedCount: 1, totalCount: 3 });
  });

  it('falls back to the prior valid plan after a newer update fails', () => {
    const fallbackPlan: PlanInput = { plan: [{ step: 'Keep this plan', status: 'pending' }] };
    const failedPlan: PlanInput = { plan: [{ step: 'Discard this plan', status: 'completed' }] };

    expect(getCurrentAcpPlan(snapshotWith(
      planCall('fallback', fallbackPlan),
      planCall('failed', failedPlan, 'failed'),
    ))).toEqual({
      steps: fallbackPlan.plan,
      completedCount: 0,
      totalCount: 1,
    });
  });

  it('returns null when no plan call exists', () => {
    expect(getCurrentAcpPlan(snapshotWith(
      planCall('other-tool', initialPlan, 'completed', 'read_file: package.json'),
    ))).toBeNull();
  });

  it.each<[string, unknown]>([
    ['missing input', undefined],
    ['an empty plan', { plan: [] }],
    ['a non-object entry', { plan: ['not a plan entry'] }],
    ['a blank step', { plan: [{ step: '   ', status: 'pending' }] }],
    ['an unknown status', { plan: [{ step: 'Unknown state', status: 'blocked' }] }],
    ['multiple in-progress steps', {
      plan: [
        { step: 'First active step', status: 'in_progress' },
        { step: 'Second active step', status: 'in_progress' },
      ],
    }],
  ])('skips a newer candidate with %s', (_description, invalidInput) => {
    const fallbackPlan: PlanInput = { plan: [{ step: 'Prior valid plan', status: 'completed' }] };

    expect(getCurrentAcpPlan(snapshotWith(
      planCall('fallback', fallbackPlan),
      planCall('invalid', invalidInput),
    ))).toEqual({
      steps: fallbackPlan.plan,
      completedCount: 1,
      totalCount: 1,
    });
  });
});
