export const PROFILES = {
  fast: [
    { name: 'Generate extension bridge', command: 'pnpm', args: ['run', 'ext:bridge'] },
    { name: 'Lint without autofix', command: 'pnpm', args: ['run', 'lint:check'] },
    { name: 'Typecheck', command: 'pnpm', args: ['run', 'typecheck'] },
    { name: 'Unit tests', command: 'pnpm', args: ['test'] },
  ],
  comms: [
    { name: 'Comms replay', command: 'pnpm', args: ['run', 'comms:replay'] },
    { name: 'Comms compare', command: 'pnpm', args: ['run', 'comms:compare'] },
  ],
  e2e: [
    { name: 'Electron E2E', command: 'pnpm', args: ['run', 'test:e2e'] },
  ],
};

export function selectSteps(requiredProfiles) {
  const selected = [];
  const seen = new Set();
  for (const profile of requiredProfiles) {
    for (const step of PROFILES[profile] ?? []) {
      const key = `${step.command} ${step.args.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ profile, ...step });
    }
  }
  return selected;
}
