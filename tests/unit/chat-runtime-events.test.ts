import { describe, expect, it } from 'vitest';
import {
  normalizeGatewayChatRuntimeEvent,
  normalizeGatewayChatRuntimeNotification,
} from '../../electron/gateway/chat-runtime-events';

describe('gateway chat runtime event normalization', () => {
  it('preserves approval identifiers and command detail', () => {
    expect(normalizeGatewayChatRuntimeEvent({
      sessionKey: 'agent:main:main',
      agentId: 'main',
      runId: 'run-approval',
      seq: 12,
      ts: 1_782_200_000_000,
      stream: 'approval',
      data: {
        phase: 'requested',
        status: 'pending',
        kind: 'exec',
        approvalId: 'approval-1',
        approvalSlug: 'approval-slug',
        itemId: 'item-1',
        toolCallId: 'call-1',
        title: 'Command approval requested',
        command: 'echo APPROVAL_OK',
        message: 'Approve this command',
        expiresAtMs: 1_782_200_060_000,
      },
    })).toEqual({
      type: 'approval.updated',
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      seq: 12,
      ts: 1_782_200_000_000,
      approvalId: 'approval-1',
      approvalSlug: 'approval-slug',
      itemId: 'item-1',
      toolCallId: 'call-1',
      title: 'Command approval requested',
      kind: 'exec',
      phase: 'requested',
      status: 'pending',
      command: 'echo APPROVAL_OK',
      message: 'Approve this command',
      agentId: 'main',
      expiresAtMs: 1_782_200_060_000,
    });
  });

  it('normalizes native exec approval request notifications', () => {
    expect(normalizeGatewayChatRuntimeNotification('exec.approval.requested', {
      id: 'approval-native-1',
      createdAtMs: 1_782_200_000_000,
      expiresAtMs: 1_782_200_060_000,
      request: {
        command: 'printf APPROVAL_ALLOW_OK',
        cwd: '/tmp/demo',
        agentId: 'main',
        sessionKey: 'agent:main:main',
        toolCallId: 'call-approval',
        allowedDecisions: ['allow-once', 'deny'],
      },
    })).toEqual({
      type: 'approval.updated',
      runId: 'approval:approval-native-1',
      sessionKey: 'agent:main:main',
      ts: 1_782_200_000_000,
      approvalId: 'approval-native-1',
      itemId: undefined,
      toolCallId: 'call-approval',
      title: undefined,
      kind: 'exec',
      phase: 'requested',
      status: 'pending',
      command: 'printf APPROVAL_ALLOW_OK',
      message: undefined,
      detail: 'printf APPROVAL_ALLOW_OK',
      agentId: 'main',
      expiresAtMs: 1_782_200_060_000,
      allowedDecisions: ['allow-once', 'deny'],
    });
  });

  it('normalizes native approval resolution notifications', () => {
    expect(normalizeGatewayChatRuntimeNotification('plugin.approval.resolved', {
      id: 'plugin:approval-1',
      decision: 'deny',
      ts: 1_782_200_001_000,
      request: {
        title: 'Dangerous plugin action',
        description: 'Plugin wants to mutate files',
        agentId: 'main',
        sessionKey: 'agent:main:main',
      },
    })).toEqual(expect.objectContaining({
      type: 'approval.updated',
      runId: 'approval:plugin:approval-1',
      sessionKey: 'agent:main:main',
      ts: 1_782_200_001_000,
      approvalId: 'plugin:approval-1',
      kind: 'plugin',
      phase: 'resolved',
      status: 'denied',
      detail: 'Plugin wants to mutate files',
      agentId: 'main',
    }));
  });
});
