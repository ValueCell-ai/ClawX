import { createRequire } from 'node:module';
import { join } from 'node:path';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

export type RuntimeModuleResolver = {
  label: string;
  resolve(specifier: string): string;
};

export function resolveModulePathWithFallbacks(
  specifier: string,
  resolvers: RuntimeModuleResolver[],
): string {
  const errors: string[] = [];

  for (const resolver of resolvers) {
    try {
      return resolver.resolve(specifier);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${resolver.label}: ${message}`);
    }
  }

  throw new Error(
    `Failed to resolve "${specifier}" from any runtime context. ${errors.join(' | ')}`,
  );
}

function getRuntimeModuleResolvers(): RuntimeModuleResolver[] {
  const candidates: Array<{ label: string; base: string | URL }> = [
    { label: 'openclaw-resolved', base: join(getOpenClawResolvedDir(), 'package.json') },
    { label: 'openclaw', base: join(getOpenClawDir(), 'package.json') },
    { label: 'app', base: import.meta.url },
  ];

  const seen = new Set<string>();
  const resolvers: RuntimeModuleResolver[] = [];

  for (const candidate of candidates) {
    const key = typeof candidate.base === 'string' ? candidate.base : candidate.base.toString();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const runtimeRequire = createRequire(candidate.base);
    resolvers.push({
      label: candidate.label,
      resolve: runtimeRequire.resolve.bind(runtimeRequire),
    });
  }

  return resolvers;
}

export function resolveOpenClawRuntimeModulePath(specifier: string): string {
  return resolveModulePathWithFallbacks(specifier, getRuntimeModuleResolvers());
}
