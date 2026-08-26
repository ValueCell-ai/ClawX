import { describe, expect, it } from 'vitest';
import { repairAssistantTurnText } from '@/lib/acp/assistant-text-repair';
import { projectOpenClawAssistantText } from '@/lib/acp/openclaw-media-compat';
import { appendSyntheticAssistantMessage, applyAcpSessionUpdate, createEmptyAcpTimeline } from '@/lib/acp/reducer';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

function userChunk(state: AcpTimelineSnapshot, messageId: string, text: string): AcpTimelineSnapshot {
  return applyAcpSessionUpdate(state, {
    sessionId: 'agent:pi:s1',
    update: { sessionUpdate: 'user_message_chunk', messageId, content: { type: 'text', text } },
  });
}

function assistantChunk(state: AcpTimelineSnapshot, messageId: string, text: string): AcpTimelineSnapshot {
  return applyAcpSessionUpdate(state, {
    sessionId: 'agent:pi:s1',
    update: { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text } },
  });
}

function toolCall(state: AcpTimelineSnapshot, toolCallId: string): AcpTimelineSnapshot {
  return applyAcpSessionUpdate(state, {
    sessionId: 'agent:pi:s1',
    update: { sessionUpdate: 'tool_call', toolCallId, title: 'Read file', status: 'completed' },
  });
}

function assistantTexts(snapshot: AcpTimelineSnapshot): string[] {
  return snapshot.itemOrder.flatMap((itemId) => {
    const item = snapshot.itemsById[itemId];
    if (item?.kind !== 'message-segment' || item.role !== 'assistant') return [];
    return item.parts.flatMap((part) => (part.kind === 'markdown' ? [part.text] : []));
  });
}

function streamedTurn(streamed: string): AcpTimelineSnapshot {
  let state = createEmptyAcpTimeline('agent:pi:s1', 1);
  state = userChunk(state, 'user-live', 'How much does it cost?');
  return assistantChunk(state, 'msg-a', streamed);
}

describe('ACP assistant text repair', () => {
  it('restores a reply whose trailing chunk never reached the timeline', () => {
    const state = streamedTurn('The pricing model is subscription based');
    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['The pricing model is subscription based, quoted per seat.'],
    });

    expect(outcome.status).toBe('repaired');
    expect(outcome.repairedSegmentCount).toBe(1);
    expect(outcome.recoveredCharacterCount).toBe(18);
    expect(assistantTexts(snapshot)).toEqual(['The pricing model is subscription based, quoted per seat.']);
  });

  it('converges a diverged reply of equal length onto the transcript', () => {
    const state = streamedTurn('alpha beta gamma');
    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['alpha gamma beta'],
    });

    expect(outcome.status).toBe('repaired');
    expect(outcome.sharedPrefixLength).toBe(6);
    expect(assistantTexts(snapshot)).toEqual(['alpha gamma beta']);
  });

  it('leaves an already matching reply byte-identical', () => {
    const state = streamedTurn('Complete answer.');
    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['Complete answer.'],
    });

    expect(outcome.status).toBe('already-matching');
    expect(snapshot).toBe(state);
  });

  it('ignores a whitespace-only difference so a settled reply never re-renders', () => {
    const state = streamedTurn('Complete answer.');
    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['Complete answer.\n\n'],
    });

    expect(outcome.status).toBe('already-matching');
    expect(snapshot).toBe(state);
  });

  it('ignores a transcript read that is shorter than the streamed reply', () => {
    const state = streamedTurn('The full answer arrived over the stream.');
    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['The full answer'],
    });

    expect(outcome.status).toBe('declined-shorter-transcript');
    expect(outcome.declinedSegmentCount).toBe(1);
    expect(snapshot).toBe(state);
  });

  it('repairs the segment that streamed before a tool call without disturbing the other', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = userChunk(state, 'user-live', 'Check the price list');
    state = assistantChunk(state, 'msg-a', 'Let me check');
    state = toolCall(state, 'tool-1');
    state = assistantChunk(state, 'msg-a', 'There is no public price list.');

    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['Let me check the vendor site.', 'There is no public price list.'],
    });

    expect(outcome.status).toBe('repaired');
    expect(outcome.repairedSegmentCount).toBe(1);
    expect(assistantTexts(snapshot)).toEqual([
      'Let me check the vendor site.',
      'There is no public price list.',
    ]);
  });

  it('declines an ambiguous pairing when the streamed segment count differs', () => {
    const state = streamedTurn('Only one streamed segment.');
    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['Only one streamed segment.', 'A second persisted reply.'],
    });

    expect(outcome.status).toBe('segment-count-mismatch');
    expect(snapshot).toBe(state);
  });

  it('excludes renderer-only compatibility segments from the pairing', () => {
    let state = streamedTurn('Here is the generated image');
    state = appendSyntheticAssistantMessage(state, {
      messageId: 'compat-1',
      evidenceId: 'evidence-1',
      parts: [{ kind: 'image', source: 'data:image/png;base64,AAA' }],
    });

    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['Here is the generated image you asked for.'],
    });

    expect(outcome.status).toBe('repaired');
    expect(outcome.streamedSegmentCount).toBe(1);
    expect(assistantTexts(snapshot)).toEqual([
      'Here is the generated image you asked for.',
    ]);
  });

  it('stops at the next turn so a later reply is never rewritten', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = userChunk(state, 'user-live', 'First question');
    state = assistantChunk(state, 'msg-a', 'First answer');
    state = userChunk(state, 'user-next', 'Second question');
    state = assistantChunk(state, 'msg-b', 'Second answer');

    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: ['First answer, completed.'],
    });

    expect(outcome.status).toBe('repaired');
    expect(assistantTexts(snapshot)).toEqual(['First answer, completed.', 'Second answer']);
  });

  it('performs no repair when the turn is not in the timeline', () => {
    const state = streamedTurn('Streamed reply');
    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-missing',
      transcriptTexts: ['Streamed reply, completed.'],
    });

    expect(outcome.status).toBe('turn-not-found');
    expect(snapshot).toBe(state);
  });
});

describe('OpenClaw transcript assistant text projection', () => {
  it('drops MEDIA directive lines the way ACP drops them from the visible reply', () => {
    const projected = projectOpenClawAssistantText(
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Here is the chart.\nMEDIA: /repo/out/chart.png\n' }],
      },
      '/repo',
    );

    expect(projected).toBe('Here is the chart.');
  });

  it('keeps a MEDIA-looking line inside a fenced code block', () => {
    const projected = projectOpenClawAssistantText(
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Example:\n```\nMEDIA: /repo/out/chart.png\n```' }],
      },
      '/repo',
    );

    expect(projected).toBe('Example:\n```\nMEDIA: /repo/out/chart.png\n```');
  });

  it('does not repair a media reply back into raw directive prose', () => {
    const state = streamedTurn('Here is the chart.');
    const transcriptText = projectOpenClawAssistantText(
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Here is the chart.\nMEDIA: /repo/out/chart.png' }],
      },
      '/repo',
    );

    const { snapshot, outcome } = repairAssistantTurnText(state, {
      liveUserMessageId: 'user-live',
      transcriptTexts: [transcriptText],
    });

    expect(outcome.status).toBe('already-matching');
    expect(snapshot).toBe(state);
  });
});
