import { describe, expect, it } from 'vitest'
import {
  isAcpWorkingDirectoryTruncatedTitle,
  isOpenClawSessionIdFallbackTitle,
  stripAcpWorkingDirectoryPrefix,
} from '@shared/chat/session-title'

describe('stripAcpWorkingDirectoryPrefix', () => {
  it('removes a leading Unix working-directory marker', () => {
    expect(
      stripAcpWorkingDirectoryPrefix(
        '[Working directory: ~/.openclaw/workspace]\n\nExplain this repository',
      ),
    ).toBe('Explain this repository')
  })

  it('removes a leading Windows working-directory marker', () => {
    expect(
      stripAcpWorkingDirectoryPrefix(
        '[Working directory: C:\\Users\\alex\\workspace\\ClawX]\r\n\r\nFix the test',
      ),
    ).toBe('Fix the test')
  })

  it('removes only the first of consecutive leading envelopes', () => {
    expect(
      stripAcpWorkingDirectoryPrefix(
        '[Working directory: /first]\n\n[Working directory: /second]\n\nPrompt',
      ),
    ).toBe('[Working directory: /second]\n\nPrompt')
  })

  it('preserves prompt indentation after the separator', () => {
    expect(
      stripAcpWorkingDirectoryPrefix(
        '[Working directory: ~/.openclaw/workspace]\n  Explain this repository',
      ),
    ).toBe('  Explain this repository')
  })

  it('preserves text without a working-directory marker', () => {
    expect(stripAcpWorkingDirectoryPrefix('Explain this repository')).toBe(
      'Explain this repository',
    )
  })

  it('preserves a non-leading working-directory marker', () => {
    expect(
      stripAcpWorkingDirectoryPrefix(
        'Question\n[Working directory: ~/.openclaw/workspace]',
      ),
    ).toBe('Question\n[Working directory: ~/.openclaw/workspace]')
  })
})

describe('isOpenClawSessionIdFallbackTitle', () => {
  const sessionId = '72e4b28b-8477-4e29-b57e-e14448fd42d0'

  it('identifies the UUID-prefix and date title generated for the same session', () => {
    expect(isOpenClawSessionIdFallbackTitle('72e4b28b (2026-07-22)', sessionId)).toBe(true)
  })

  it('does not discard user labels or another session prefix', () => {
    expect(isOpenClawSessionIdFallbackTitle('用浏览器打开B站', sessionId)).toBe(false)
    expect(isOpenClawSessionIdFallbackTitle('9add3001 (2026-07-22)', sessionId)).toBe(false)
    expect(isOpenClawSessionIdFallbackTitle('72e4b28b (2026-07-22)', undefined)).toBe(false)
  })
})

describe('isAcpWorkingDirectoryTruncatedTitle', () => {
  it('identifies a cwd envelope truncated before the user prompt', () => {
    expect(
      isAcpWorkingDirectoryTruncatedTitle(
        '[Working directory: ~/workspace/clawx-playground]…',
      ),
    ).toBe(true)
  })

  it('preserves an ellipsis after the normal cwd separator', () => {
    expect(
      isAcpWorkingDirectoryTruncatedTitle(
        '[Working directory: ~/workspace/clawx-playground]\n\n…',
      ),
    ).toBe(false)
    expect(isAcpWorkingDirectoryTruncatedTitle('…')).toBe(false)
  })
})
