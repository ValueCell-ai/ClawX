import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { describe, expect, it } from 'vitest';

import playwrightConfig from '../../playwright.config';
import {
  DEFAULT_E2E_WORKERS,
  E2E_EXCLUSIVE_TAG,
  E2E_PERFORMANCE_TAG,
} from '../e2e/parallel-policy';

const e2eDir = path.resolve('tests/e2e');

async function readSpecTree(directory: string): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return readSpecTree(file);
    if (!entry.isFile() || !/\.spec\.tsx?$/.test(entry.name)) return [];
    return [{ file, source: await readFile(file, 'utf8') }];
  }));
  return nested.flat();
}

function accessPath(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = accessPath(expression.expression);
    return parent ? [...parent, expression.name.text] : null;
  }
  if (ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)) {
    const parent = accessPath(expression.expression);
    return parent ? [...parent, expression.argumentExpression.text] : null;
  }
  return null;
}

function isGlobalClipboardCall(node: ts.CallExpression): boolean {
  const pathParts = accessPath(node.expression);
  if (!pathParts) return false;
  if (pathParts.length === 1) {
    return ['installWebBrowserPolicyInstrumentation', 'pressNativeNewChatShortcut'].includes(pathParts[0]);
  }

  const method = pathParts.at(-1) ?? '';
  return pathParts.at(-2) === 'clipboard' && /^(?:clear|read\w*|write\w*)$/.test(method);
}

function appliesTag(call: ts.CallExpression, tagName: string): boolean {
  return call.arguments.some((argument) => (
    ts.isObjectLiteralExpression(argument)
    && argument.properties.some((property) => (
      ts.isPropertyAssignment(property)
      && property.name.getText() === 'tag'
      && ts.isIdentifier(property.initializer)
      && property.initializer.text === tagName
    ))
  ));
}

function hasTaggedTestAncestor(node: ts.Node, tagName: string): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (!ts.isCallExpression(current)) continue;
    const expression = current.expression.getText();
    if ((expression === 'test' || expression === 'test.describe') && appliesTag(current, tagName)) {
      return true;
    }
  }
  return false;
}

function untaggedGlobalClipboardCalls(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const untagged: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)
      && isGlobalClipboardCall(node)
      && !hasTaggedTestAncestor(node, 'E2E_EXCLUSIVE_TAG')) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      untagged.push(`${path.relative(e2eDir, file)}:${line + 1}:${character + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return untagged;
}

function untaggedTestDefinitions(file: string, source: string, tagName: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const untagged: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const pathParts = accessPath(node.expression);
      const isTestDefinition = pathParts?.[0] === 'test'
        && (pathParts.length === 1 || ['fixme', 'only', 'skip'].includes(pathParts[1]))
        && ts.isStringLiteralLike(node.arguments[0]);
      if (isTestDefinition && !hasTaggedTestAncestor(node, tagName)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        untagged.push(`${path.relative(e2eDir, file)}:${line + 1}:${character + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return untagged;
}

describe('Electron E2E parallel policy', () => {
  it('runs isolated tests concurrently while fencing global resources and performance profiles', () => {
    const projects = playwrightConfig.projects ?? [];
    const exclusive = projects.find((project) => project.name === 'exclusive');
    const parallel = projects.find((project) => project.name === 'parallel');
    const performance = projects.find((project) => project.name === 'performance');

    expect(playwrightConfig.fullyParallel).toBe(false);
    expect(DEFAULT_E2E_WORKERS).toBeGreaterThan(1);
    expect(playwrightConfig.workers).toBe(
      process.env.CLAWX_E2E_WORKERS ? Number(process.env.CLAWX_E2E_WORKERS) : DEFAULT_E2E_WORKERS,
    );
    expect(exclusive?.workers).toBe(1);
    expect(String(exclusive?.grep)).toContain(E2E_EXCLUSIVE_TAG);
    expect(parallel?.dependencies).toEqual(['exclusive']);
    expect(String(parallel?.grepInvert)).toContain(E2E_EXCLUSIVE_TAG);
    expect(String(parallel?.grepInvert)).toContain(E2E_PERFORMANCE_TAG);
    expect(performance?.workers).toBe(1);
    expect(performance?.dependencies).toEqual(['parallel']);
    expect(String(performance?.grep)).toContain(E2E_PERFORMANCE_TAG);
  });

  it('keeps specs that access the real clipboard in the exclusive project', async () => {
    const specs = await readSpecTree(e2eDir);
    const untagged = specs.flatMap(({ file, source }) => untaggedGlobalClipboardCalls(file, source));
    expect(untagged, 'OS clipboard calls must be enclosed by an exclusively tagged test or describe')
      .toEqual([]);
  });

  it('does not accept an unused exclusive tag import', () => {
    const source = [
      "import { E2E_EXCLUSIVE_TAG } from './parallel-policy';",
      "test('copy', async () => navigator.clipboard.readText());",
    ].join('\n');
    const untagged = untaggedGlobalClipboardCalls(path.join(e2eDir, 'unused-tag.spec.ts'), source);
    expect(untagged).toHaveLength(1);
    expect(untagged[0]).toMatch(/^unused-tag\.spec\.ts:2:/);
  });

  it('recognizes optional and element access to the OS clipboard', () => {
    const source = [
      "test('optional', async () => navigator.clipboard?.readText());",
      "test('element', async () => navigator.clipboard['writeText']('value'));",
    ].join('\n');
    const untagged = untaggedGlobalClipboardCalls(path.join(e2eDir, 'access-forms.spec.ts'), source);
    expect(untagged).toHaveLength(2);
  });

  it('requires exclusive execution for OS keyboard shortcuts', () => {
    const source = [
      "test('untagged', async () => pressNativeNewChatShortcut(app));",
      "test('tagged', { tag: E2E_EXCLUSIVE_TAG }, async () => pressNativeNewChatShortcut(app));",
    ].join('\n');
    const untagged = untaggedGlobalClipboardCalls(path.join(e2eDir, 'keyboard.spec.ts'), source);
    expect(untagged).toHaveLength(1);
    expect(untagged[0]).toMatch(/^keyboard\.spec\.ts:1:/);
  });

  it('keeps renderer performance profiles in the performance project', async () => {
    const file = path.join(e2eDir, 'renderer-performance.spec.ts');
    const source = await readFile(file, 'utf8');
    expect(untaggedTestDefinitions(file, source, 'E2E_PERFORMANCE_TAG')).toEqual([]);
  });

  it('rejects an individually untagged performance test', () => {
    const source = [
      "test('tagged', { tag: E2E_PERFORMANCE_TAG }, async () => {});",
      "test('untagged', async () => {});",
    ].join('\n');
    const file = path.join(e2eDir, 'synthetic-performance.spec.ts');
    expect(untaggedTestDefinitions(file, source, 'E2E_PERFORMANCE_TAG')).toEqual([
      'synthetic-performance.spec.ts:2:1',
    ]);
  });
});
