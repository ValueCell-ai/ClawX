import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@shared/chat/types';
import {
  alignOpenClawMediaTurns,
  extractOpenClawMediaTurns,
} from '@/lib/acp/openclaw-media-compat';
import {
  appendSyntheticAssistantMessage,
  createEmptyAcpTimeline,
  upsertSyntheticTurnAttachments,
} from '@/lib/acp/reducer';
import type { AcpTimelineSnapshot, AttachmentRenderPart } from '@/lib/acp/timeline-types';

function transcript(...messages: RawMessage[]): RawMessage[] {
  return messages;
}

function extract(messages: RawMessage[], suppressedUris = new Set<string>()) {
  return extractOpenClawMediaTurns(messages, {
    executionCwd: '/workspace/project',
    suppressedUris,
  });
}

function timeline(
  turns: Array<{
    userId: string;
    userText: string;
    userPromptTextBlocks?: string[];
    assistantId?: string;
    assistantText?: string;
  }>,
): AcpTimelineSnapshot {
  const snapshot = createEmptyAcpTimeline('agent:main:session-1', 4);
  for (const turn of turns) {
    const userItemId = `${turn.userId}:0`;
    snapshot.itemOrder.push(userItemId);
    snapshot.itemsById[userItemId] = {
      kind: 'message-segment',
      id: userItemId,
      role: 'user',
      messageId: turn.userId,
      segmentIndex: 0,
      parts: [{ kind: 'markdown', text: turn.userText }],
      ...(turn.userPromptTextBlocks ? { userPromptTextBlocks: turn.userPromptTextBlocks } : {}),
    };
    if (turn.assistantId) {
      const assistantItemId = `${turn.assistantId}:0`;
      snapshot.itemOrder.push(assistantItemId);
      snapshot.itemsById[assistantItemId] = {
        kind: 'message-segment',
        id: assistantItemId,
        role: 'assistant',
        messageId: turn.assistantId,
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: turn.assistantText ?? '' }],
      };
    }
  }
  return snapshot;
}

function availableAttachment(id: string, identity: string): AttachmentRenderPart {
  const uri = `/workspace/project/${id}.png`;
  return {
    kind: 'attachment',
    attachmentId: id,
    reference: { uri, name: `${id}.png` },
    source: 'openclaw-media',
    evidenceId: `evidence:${id}`,
    access: {
      status: 'available',
      identity,
      mimeType: 'image/png',
      size: 12,
      target: {
        kind: 'local',
        scope: 'workspace',
        ref: { sessionKey: 'agent:main:session-1', generation: 4, uri },
      },
    },
  };
}

describe('OpenClaw MEDIA transcript extraction', () => {
  it('accepts the approved explicit reference forms and preserves directive order', () => {
    const [turn] = extract(transcript(
      { role: 'user', content: 'Create the exports' },
      {
        role: 'assistant',
        id: 'assistant-files',
        content: [
          {
            type: 'text',
            text: [
              '  MEDIA:/tmp/report.pdf',
              'MEDIA:C:\\Users\\alex\\report.xlsx',
              'MEDIA:file:///tmp/report.csv',
              'MEDIA:~/report.txt',
              'MEDIA:exports/report.json',
              'MEDIA:https://example.test/report.zip',
              'MEDIA:http://example.test/report.txt',
              'MEDIA:"/tmp/quarterly report.xlsx"',
            ].join('\n'),
          },
        ],
      },
    ));

    expect(turn?.candidates.map((candidate) => candidate.uri)).toEqual([
      '/tmp/report.pdf',
      'C:\\Users\\alex\\report.xlsx',
      'file:///tmp/report.csv',
      '~/report.txt',
      'exports/report.json',
      'https://example.test/report.zip',
      'http://example.test/report.txt',
      '/tmp/quarterly report.xlsx',
    ]);
    expect(turn?.candidates.map((candidate) => candidate.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(turn?.candidates.every((candidate) => candidate.transcriptMessageId === 'assistant-files')).toBe(true);
  });

  it('rejects fenced, wrapped, inline, unknown-scheme, malformed, and overlong references', () => {
    const tooLong = `/tmp/${'x'.repeat(4092)}`;
    const [turn] = extract(transcript(
      { role: 'user', content: 'Create the export' },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: [
              '```text',
              'MEDIA:/tmp/fenced.txt',
              '```',
              '- MEDIA:/tmp/list.txt',
              '**MEDIA:/tmp/bold.txt**',
              'Here is MEDIA:/tmp/inline.txt',
              'ftp://example.test/bare.txt',
              'MEDIA:ftp://example.test/file.txt',
              'MEDIA:/tmp/path with unquoted spaces.txt',
              `MEDIA:${tooLong}`,
              '/tmp/bare.txt',
            ].join('\n'),
          },
        ],
      },
      { role: 'toolresult', content: 'MEDIA:/tmp/tool.txt' },
      { role: 'system', content: 'MEDIA:/tmp/system.txt' },
      { role: 'user', content: 'MEDIA:/tmp/user.txt' },
    ));

    expect(turn?.candidates).toEqual([]);
  });

  it('requires a fence close to use the same delimiter and at least the opening length', () => {
    const [turn] = extract(transcript(
      { role: 'user', content: 'Create exports' },
      {
        role: 'assistant',
        content: [
          '````markdown',
          'MEDIA:/tmp/hidden-backtick-a.txt',
          '```',
          'MEDIA:/tmp/hidden-backtick-b.txt',
          '````',
          'MEDIA:/tmp/visible-backtick.txt',
          '~~~~text',
          'MEDIA:/tmp/hidden-tilde-a.txt',
          '```',
          'MEDIA:/tmp/hidden-tilde-b.txt',
          '~~~',
          'MEDIA:/tmp/hidden-tilde-c.txt',
          '~~~~~',
          'MEDIA:/tmp/visible-tilde.txt',
        ].join('\n'),
      },
    ));

    expect(turn?.candidates.map((candidate) => candidate.uri)).toEqual([
      '/tmp/visible-backtick.txt',
      '/tmp/visible-tilde.txt',
    ]);
  });

  it('keeps backtick MEDIA fenced after trailing-text and over-indented close candidates', () => {
    const [turn] = extract(transcript(
      { role: 'user', content: 'Create exports' },
      {
        role: 'assistant',
        content: [
          '```text',
          'MEDIA:/tmp/hidden-backtick-a.txt',
          '```not-a-close',
          'MEDIA:/tmp/hidden-backtick-b.txt',
          '    ```',
          'MEDIA:/tmp/hidden-backtick-c.txt',
          '  ``` \t',
          'MEDIA:/tmp/visible-backtick.txt',
        ].join('\n'),
      },
    ));

    expect(turn?.candidates.map((candidate) => candidate.uri)).toEqual([
      '/tmp/visible-backtick.txt',
    ]);
  });

  it('keeps tilde MEDIA fenced after trailing-text and over-indented close candidates', () => {
    const [turn] = extract(transcript(
      { role: 'user', content: 'Create exports' },
      {
        role: 'assistant',
        content: [
          '~~~~text',
          'MEDIA:/tmp/hidden-tilde-a.txt',
          '~~~~not-a-close',
          'MEDIA:/tmp/hidden-tilde-b.txt',
          '    ~~~~~',
          'MEDIA:/tmp/hidden-tilde-c.txt',
          ' ~~~~~\t',
          'MEDIA:/tmp/visible-tilde.txt',
        ].join('\n'),
      },
    ));

    expect(turn?.candidates.map((candidate) => candidate.uri)).toEqual([
      '/tmp/visible-tilde.txt',
    ]);
  });

  it('does not open a fence indented by more than three spaces', () => {
    const [turn] = extract(transcript(
      { role: 'user', content: 'Create exports' },
      {
        role: 'assistant',
        content: [
          '    ```text',
          'MEDIA:/tmp/visible-after-indented-backtick.txt',
          '    ~~~~text',
          'MEDIA:/tmp/visible-after-indented-tilde.txt',
        ].join('\n'),
      },
    ));

    expect(turn?.candidates.map((candidate) => candidate.uri)).toEqual([
      '/tmp/visible-after-indented-backtick.txt',
      '/tmp/visible-after-indented-tilde.txt',
    ]);
  });

  it('removes only a leading ACP working-directory envelope while matching user text', () => {
    const turns = extract(transcript(
      { role: 'user', content: '[Working directory: /workspace/project]\n\nCreate report' },
      { role: 'assistant', content: 'MEDIA:report.pdf' },
      { role: 'user', content: 'Keep this text\n[Working directory: /authored/example]' },
      { role: 'assistant', content: 'MEDIA:notes.txt' },
    ));

    expect(turns.map((turn) => turn.normalizedUserText)).toEqual([
      'Create report',
      'Keep this text\n[Working directory: /authored/example]',
    ]);
  });

  it('uses stable evidence ids across immediate and delayed reads', () => {
    const messages = transcript(
      { role: 'user', content: 'Create report' },
      { role: 'assistant', id: 'assistant-report', content: 'MEDIA:report.pdf' },
    );

    expect(extract(messages)[0]?.candidates[0]?.evidenceId)
      .toBe(extract(structuredClone(messages))[0]?.candidates[0]?.evidenceId);
  });

  it('keeps fallback evidence stable when unrelated messages shift the transcript window', () => {
    const targetTurn = transcript(
      { role: 'user', content: 'Create report' },
      { role: 'assistant', content: 'MEDIA:report.pdf' },
    );
    const shifted = transcript(
      { role: 'user', content: 'Unrelated prompt' },
      { role: 'assistant', content: 'Unrelated answer' },
      ...targetTurn,
    );

    expect(extract(targetTurn)[0]?.candidates[0]?.evidenceId)
      .toBe(extract(shifted)[1]?.candidates[0]?.evidenceId);
  });

  it('gives repeated identical turns distinct fallback evidence ids', () => {
    const turns = extract(transcript(
      { role: 'user', content: 'Create report' },
      { role: 'assistant', content: 'MEDIA:report.pdf' },
      { role: 'user', content: 'Create report' },
      { role: 'assistant', content: 'MEDIA:report.pdf' },
    ));

    expect(turns[0]?.candidates[0]?.evidenceId).not.toBe(turns[1]?.candidates[0]?.evidenceId);
  });

  it('suppresses only exact image-generation candidate keys', () => {
    const [turn] = extract(transcript(
      { role: 'user', content: 'Create assets' },
      {
        role: 'assistant',
        content: 'MEDIA:/tmp/generated.png\nMEDIA:file:///tmp/generated.png\nMEDIA:/tmp/report.pdf',
      },
    ), new Set(['/tmp/generated.png']));

    expect(turn?.candidates.map((candidate) => candidate.uri)).toEqual([
      'file:///tmp/generated.png',
      '/tmp/report.pdf',
    ]);
  });

  it('keeps an explicit image directive without proven image-generation evidence', () => {
    const [turn] = extract(transcript(
      { role: 'user', content: 'Send the screenshot' },
      { role: 'assistant', content: 'MEDIA:/tmp/screenshot.png' },
    ));

    expect(turn?.candidates).toMatchObject([{ uri: '/tmp/screenshot.png' }]);
  });
});

describe('OpenClaw MEDIA transcript turn alignment', () => {
  it('aligns a structured resource-link user turn with OpenClaw transcript projection', () => {
    const resourcePath = 'C:\\Users\\Administrator\\.openclaw\\media\\input.xlsx';
    const snapshot = timeline([{
      userId: 'user-with-resource',
      userText: 'Create the report',
      userPromptTextBlocks: [
        'Create the report',
        `[Resource link] ${resourcePath}`,
      ],
    }]);
    const turns = extract(transcript(
      {
        role: 'user',
        content: `[Working directory: C:\\Users\\Administrator\\.openclaw\\workspace]\n\nCreate the report\n[Resource link] ${resourcePath}`,
      },
      { role: 'assistant', content: 'MEDIA:C:\\Users\\Administrator\\.openclaw\\media\\report.xlsx' },
    ));

    expect(alignOpenClawMediaTurns(snapshot, turns, {})).toMatchObject([{
      acpTurnId: 'user-with-resource',
      candidates: [{ uri: 'C:\\Users\\Administrator\\.openclaw\\media\\report.xlsx' }],
    }]);
  });

  it('aligns attachment-only turns with empty OpenClaw prompt text by occurrence from the tail', () => {
    const snapshot = timeline([
      { userId: 'image-first', userText: '', userPromptTextBlocks: [] },
      { userId: 'image-last', userText: '', userPromptTextBlocks: [] },
    ]);
    const turns = extract(transcript(
      { role: 'user', content: '[Working directory: /workspace/project]\n\n' },
      { role: 'assistant', content: 'MEDIA:/tmp/first.pdf' },
      { role: 'user', content: '[Working directory: /workspace/project]\n\n' },
      { role: 'assistant', content: 'MEDIA:/tmp/last.pdf' },
    ));

    expect(alignOpenClawMediaTurns(snapshot, turns, {})).toMatchObject([
      { acpTurnId: 'image-first', candidates: [{ uri: '/tmp/first.pdf' }] },
      { acpTurnId: 'image-last', candidates: [{ uri: '/tmp/last.pdf' }] },
    ]);
  });

  it('keeps user-authored Resource link marker text in the exact alignment key', () => {
    const authoredText = 'Explain this literal syntax:\n[Resource link] /not-an-attachment.txt';
    const snapshot = timeline([{
      userId: 'literal-marker',
      userText: authoredText,
      userPromptTextBlocks: [authoredText],
    }]);
    const turns = extract(transcript(
      { role: 'user', content: authoredText },
      { role: 'assistant', content: 'MEDIA:/tmp/explanation.pdf' },
    ));

    expect(alignOpenClawMediaTurns(snapshot, turns, {})).toMatchObject([{
      acpTurnId: 'literal-marker',
      candidates: [{ uri: '/tmp/explanation.pdf' }],
    }]);
  });

  it('aligns a bounded transcript suffix newest-to-oldest', () => {
    const snapshot = timeline([
      { userId: 'user-old', userText: 'Old prompt', assistantId: 'assistant-old' },
      { userId: 'user-middle', userText: 'Middle prompt', assistantId: 'assistant-middle' },
      { userId: 'user-new', userText: 'New prompt', assistantId: 'assistant-new' },
    ]);
    const turns = extract(transcript(
      { role: 'user', content: 'Middle prompt' },
      { role: 'assistant', content: 'MEDIA:middle.pdf' },
      { role: 'user', content: 'New prompt' },
      { role: 'assistant', content: 'MEDIA:new.pdf' },
    ));

    expect(alignOpenClawMediaTurns(snapshot, turns, {})).toMatchObject([
      { acpTurnId: 'user-middle', candidates: [{ uri: 'middle.pdf' }] },
      { acpTurnId: 'user-new', candidates: [{ uri: 'new.pdf' }] },
    ]);
  });

  it('matches repeated prompts by occurrence from the tail', () => {
    const snapshot = timeline([
      { userId: 'user-first', userText: 'Repeat', assistantId: 'assistant-first' },
      { userId: 'user-other', userText: 'Other', assistantId: 'assistant-other' },
      { userId: 'user-last', userText: 'Repeat', assistantId: 'assistant-last' },
    ]);
    const turns = extract(transcript(
      { role: 'user', content: 'Repeat' },
      { role: 'assistant', content: 'MEDIA:first.pdf' },
      { role: 'user', content: 'Other' },
      { role: 'assistant', content: 'No attachment' },
      { role: 'user', content: 'Repeat' },
      { role: 'assistant', content: 'MEDIA:last.pdf' },
    ));

    expect(alignOpenClawMediaTurns(snapshot, turns, {})).toMatchObject([
      { acpTurnId: 'user-first', candidates: [{ uri: 'first.pdf' }] },
      { acpTurnId: 'user-last', candidates: [{ uri: 'last.pdf' }] },
    ]);
  });

  it('rejects missing anchors and restricts live matching to the optimistic user identity', () => {
    const snapshot = timeline([
      { userId: 'user-first', userText: 'First', assistantId: 'assistant-first' },
      { userId: 'user-live', userText: 'Live prompt' },
    ]);
    const turns = extract(transcript(
      { role: 'user', content: 'Missing' },
      { role: 'assistant', content: 'MEDIA:missing.pdf' },
      { role: 'user', content: 'Live prompt' },
      { role: 'assistant', content: 'MEDIA:live.pdf' },
    ));

    expect(alignOpenClawMediaTurns(snapshot, turns, { liveUserMessageId: 'user-first' })).toEqual([]);
    expect(alignOpenClawMediaTurns(snapshot, turns, { liveUserMessageId: 'user-live' })).toMatchObject([
      { acpTurnId: 'user-live', candidates: [{ uri: 'live.pdf' }] },
    ]);
  });

  it('aligns an attachment-only assistant output to a user turn without an ACP assistant segment', () => {
    const snapshot = timeline([{ userId: 'user-only', userText: 'Create report' }]);
    const turns = extract(transcript(
      { role: 'user', content: 'Create report' },
      { role: 'assistant', content: 'MEDIA:report.pdf' },
    ));

    expect(alignOpenClawMediaTurns(snapshot, turns, {})).toMatchObject([
      { acpTurnId: 'user-only', candidates: [{ uri: 'report.pdf' }] },
    ]);
  });
});

describe('synthetic OpenClaw MEDIA projection', () => {
  it('anchors marked attachment-only segments inside the matching turn', () => {
    const snapshot = timeline([
      { userId: 'user-report', userText: 'Create report' },
      { userId: 'user-next', userText: 'Next', assistantId: 'assistant-next' },
    ]);
    const projected = upsertSyntheticTurnAttachments(snapshot, {
      turnId: 'user-report',
      evidenceId: 'evidence-report',
      attachments: [availableAttachment('report', 'report-identity')],
      source: 'openclaw-media',
    });

    expect(projected.itemOrder).toEqual([
      'user-report:0',
      'compat:openclaw-media:evidence-report:0',
      'user-next:0',
      'assistant-next:0',
    ]);
    expect(projected.itemsById['compat:openclaw-media:evidence-report:0']).toMatchObject({
      role: 'assistant',
      compat: { source: 'openclaw-media', evidenceId: 'evidence-report' },
      parts: [{ attachmentId: 'report' }],
    });
  });

  it('lets an inline image remove an earlier same-identity attachment card', () => {
    const snapshot = upsertSyntheticTurnAttachments(
      timeline([{ userId: 'user-image', userText: 'Create image' }]),
      {
        turnId: 'user-image',
        evidenceId: 'attachment-evidence',
        attachments: [availableAttachment('generated', 'same-media')],
        source: 'openclaw-media',
      },
    );
    const projected = appendSyntheticAssistantMessage(snapshot, {
      messageId: 'compat:image-generation:image-evidence',
      evidenceId: 'image-evidence',
      parts: [{ kind: 'image', source: 'data:image/png;base64,abc', mediaIdentity: 'same-media' }],
    });

    const attachments = Object.values(projected.itemsById)
      .flatMap((item) => item.kind === 'message-segment' ? item.parts : [])
      .filter((part) => part.kind === 'attachment');
    expect(attachments).toEqual([]);
  });

  it('rejects a same-identity attachment card when the inline image arrived first', () => {
    const withImage = appendSyntheticAssistantMessage(
      timeline([{ userId: 'user-image', userText: 'Create image' }]),
      {
        messageId: 'compat:image-generation:image-evidence',
        evidenceId: 'image-evidence',
        parts: [{ kind: 'image', source: 'data:image/png;base64,abc', mediaIdentity: 'same-media' }],
      },
    );
    const projected = upsertSyntheticTurnAttachments(withImage, {
      turnId: 'user-image',
      evidenceId: 'attachment-evidence',
      attachments: [availableAttachment('generated', 'same-media')],
      source: 'openclaw-media',
    });

    const attachments = Object.values(projected.itemsById)
      .flatMap((item) => item.kind === 'message-segment' ? item.parts : [])
      .filter((part) => part.kind === 'attachment');
    expect(attachments).toEqual([]);
  });

  it.each([
    '/workspace/project/generated.png',
    'file:///workspace/project/generated.png',
    '~/project/generated.png',
    'generated.png',
    '/api/chat/media/outgoing/agent%3Amain%3Asession-1/attachment/full',
  ])('dedupes equivalent resolved reference %s by opaque identity', (uri) => {
    const withImage = appendSyntheticAssistantMessage(
      timeline([{ userId: 'user-image', userText: 'Create image' }]),
      {
        messageId: 'compat:image-generation:image-evidence',
        evidenceId: 'image-evidence',
        parts: [{ kind: 'image', source: 'data:image/png;base64,abc', mediaIdentity: 'canonical-image' }],
      },
    );
    const attachment = availableAttachment('generated', 'canonical-image');
    attachment.reference.uri = uri;
    const projected = upsertSyntheticTurnAttachments(withImage, {
      turnId: 'user-image',
      evidenceId: `attachment-${attachment.attachmentId}`,
      attachments: [attachment],
      source: 'openclaw-media',
    });

    expect(Object.values(projected.itemsById)
      .flatMap((item) => item.kind === 'message-segment' ? item.parts : [])
      .filter((part) => part.kind === 'attachment')).toEqual([]);
  });
});
