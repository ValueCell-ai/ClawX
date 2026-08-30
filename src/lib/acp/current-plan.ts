import type { AcpTimelineSnapshot } from './timeline-types';

type AcpCurrentPlanStatus = 'pending' | 'in_progress' | 'completed';

export type AcpCurrentPlanStep = {
  step: string;
  status: AcpCurrentPlanStatus;
};

export type AcpCurrentPlan = {
  steps: AcpCurrentPlanStep[];
  completedCount: number;
  totalCount: number;
};

function isPlanStatus(value: unknown): value is AcpCurrentPlanStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}

function projectPlan(input: unknown): AcpCurrentPlan | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const plan = (input as { plan?: unknown }).plan;
  if (!Array.isArray(plan) || plan.length === 0) return null;

  const steps: AcpCurrentPlanStep[] = [];
  let completedCount = 0;
  let inProgressCount = 0;

  for (const entry of plan) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const { step, status } = entry as { step?: unknown; status?: unknown };
    if (typeof step !== 'string' || step.trim().length === 0 || !isPlanStatus(status)) return null;

    if (status === 'completed') completedCount += 1;
    if (status === 'in_progress') inProgressCount += 1;
    if (inProgressCount > 1) return null;
    steps.push({ step, status });
  }

  return { steps, completedCount, totalCount: steps.length };
}

function isUpdatePlanTitle(title: string): boolean {
  const separatorIndex = title.indexOf(':');
  return separatorIndex > 0 && title.slice(0, separatorIndex) === 'update_plan';
}

export function getCurrentAcpPlan(snapshot: AcpTimelineSnapshot): AcpCurrentPlan | null {
  for (let index = snapshot.itemOrder.length - 1; index >= 0; index -= 1) {
    const item = snapshot.itemsById[snapshot.itemOrder[index]];
    if (!item || item.kind !== 'tool-call' || item.status === 'failed' || !isUpdatePlanTitle(item.title)) {
      continue;
    }

    const plan = projectPlan(item.input);
    if (plan) return plan;
  }

  return null;
}
