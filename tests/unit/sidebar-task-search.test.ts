import { describe, expect, it } from 'vitest';
import { matchesTaskSearch } from '@/components/layout/task-search';

const session = { key: 'agent:research:session-1', derivedTitle: 'Résumé for October' };
const match = (query: string, labels = {}) => matchesTaskSearch(query, session, labels, 'Research assistant', 'Reports', '/projects/reports');

describe('task catalog metadata search', () => {
  it('matches normalized title, assistant and workspace terms together', () => {
    expect(match('resume OCTOBER')).toBe(true);
    expect(match('research reports')).toBe(true);
    expect(match('/projects')).toBe(true);
    expect(match('october missing')).toBe(false);
    expect(match('  ')).toBe(true);
  });
  it('uses renamed display titles without turning protocol ids into searchable content', () => {
    expect(match('Final brief', { [session.key]: 'Final brief' })).toBe(true);
    expect(match('October', { [session.key]: 'Final brief' })).toBe(false);
    expect(match('session-1')).toBe(false);
  });
});
