import { describe, expect, it } from 'vitest';

import {
  parseFrontmatter,
  pathMatchesAny,
} from '../../harness/src/specs.mjs';
import {
  scanBackendCommunicationBoundary,
  touchesCommunicationPath,
  validateGatewayTaskSpec,
} from '../../harness/src/rules.mjs';

describe('harness specs', () => {
  it('parses Markdown frontmatter with arrays and nested docs', () => {
    const spec = parseFrontmatter(`---
id: example
requiredProfiles:
  - fast
  - comms
docs:
  required: false
---

Body`);

    expect(spec.data.id).toBe('example');
    expect(spec.data.requiredProfiles).toEqual(['fast', 'comms']);
    expect(spec.data.docs).toEqual({ required: false });
  });

  it('matches repository glob paths', () => {
    expect(pathMatchesAny('src/stores/chat/history-actions.ts', ['src/stores/chat/**'])).toBe(true);
    expect(pathMatchesAny('src/lib/api-client.ts', ['src/lib/api-client.ts'])).toBe(true);
    expect(pathMatchesAny('src/pages/Chat/index.tsx', ['electron/gateway/**'])).toBe(false);
  });

  it('requires gateway backend communication tasks to run fast and comms', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/example.md',
      data: {
        id: 'example',
        title: 'Example',
        scenario: 'gateway-backend-communication',
        taskType: 'runtime-bridge',
        intent: 'Adjust backend communication.',
        touchedAreas: ['src/lib/api-client.ts'],
        expectedUserBehavior: ['Visible state remains consistent.'],
        requiredProfiles: ['fast'],
        acceptance: ['Comms compare passes.'],
        docs: { required: false },
      },
    };
    const scenarioSpec = {
      data: {
        requiredProfiles: ['fast', 'comms'],
        ownedPaths: ['src/lib/api-client.ts'],
      },
    };

    expect(validateGatewayTaskSpec(taskSpec, scenarioSpec)).toContain(
      'harness/specs/tasks/example.md: requiredProfiles must include "comms"',
    );
  });

  it('detects communication path changes', () => {
    expect(touchesCommunicationPath(['electron/gateway/manager.ts'])).toBe(true);
    expect(touchesCommunicationPath(['README.md'])).toBe(false);
  });

  it('blocks direct Gateway HTTP in renderer files', async () => {
    const failures = await scanBackendCommunicationBoundary(['src/pages/Chat/index.tsx']);
    expect(failures).toEqual([]);
  });

  it('allows fallback flags only in their boundary modules', async () => {
    const failures = await scanBackendCommunicationBoundary([
      'src/lib/api-client.ts',
      'src/lib/host-api.ts',
      'src/lib/host-events.ts',
    ]);
    expect(failures).toEqual([]);
  });

  it('allows pages and components to display gatewayReady state', async () => {
    const failures = await scanBackendCommunicationBoundary(['src/components/layout/Sidebar.tsx']);
    expect(failures).toEqual([]);
  });
});
