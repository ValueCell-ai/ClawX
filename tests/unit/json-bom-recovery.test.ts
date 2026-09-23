import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairUtf8BomJsonFiles } from '../../electron/utils/json-bom-recovery';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const testDirectories: string[] = [];

async function createTestDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'clawx-json-bom-'));
  testDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('repairUtf8BomJsonFiles', () => {
  it('atomically removes UTF-8 BOMs from top-level JSON files', async () => {
    const directory = await createTestDirectory();
    const enterprisePath = join(directory, 'enterprise-auth.json');
    const providerPath = join(directory, 'clawx-providers.json');
    const enterpriseJson = '{"authGatewayUrl":"https://example.test"}';
    const providerJson = '{"schemaVersion":1,"providers":{}}';

    await writeFile(enterprisePath, Buffer.concat([UTF8_BOM, Buffer.from(enterpriseJson)]));
    await writeFile(providerPath, Buffer.concat([UTF8_BOM, Buffer.from(providerJson)]));

    const result = await repairUtf8BomJsonFiles(directory);

    expect(result).toEqual({
      repairedFiles: ['clawx-providers.json', 'enterprise-auth.json'],
      failures: [],
    });
    expect(await readFile(enterprisePath, 'utf8')).toBe(enterpriseJson);
    expect(await readFile(providerPath, 'utf8')).toBe(providerJson);
    expect(await readdir(directory)).toEqual(['clawx-providers.json', 'enterprise-auth.json']);
  });

  it('leaves valid files, nested files, and non-JSON files unchanged', async () => {
    const directory = await createTestDirectory();
    const nestedDirectory = join(directory, 'nested');
    const validPath = join(directory, 'settings.json');
    const textPath = join(directory, 'notes.txt');
    const nestedPath = join(nestedDirectory, 'extension.json');
    const nestedContent = Buffer.concat([UTF8_BOM, Buffer.from('{"nested":true}')]);

    await mkdir(nestedDirectory);
    await writeFile(validPath, '{"theme":"dark"}');
    await writeFile(textPath, Buffer.concat([UTF8_BOM, Buffer.from('notes')]));
    await writeFile(nestedPath, nestedContent);

    const result = await repairUtf8BomJsonFiles(directory);

    expect(result).toEqual({ repairedFiles: [], failures: [] });
    expect(await readFile(validPath, 'utf8')).toBe('{"theme":"dark"}');
    expect(await readFile(textPath)).toEqual(Buffer.concat([UTF8_BOM, Buffer.from('notes')]));
    expect(await readFile(nestedPath)).toEqual(nestedContent);
  });

  it('does not rewrite BOM-prefixed content that is still invalid JSON', async () => {
    const directory = await createTestDirectory();
    const invalidPath = join(directory, 'enterprise-auth.json');
    const original = Buffer.concat([UTF8_BOM, Buffer.from('{invalid json')]);
    await writeFile(invalidPath, original);

    const result = await repairUtf8BomJsonFiles(directory);

    expect(result.repairedFiles).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ fileName: 'enterprise-auth.json' });
    expect(await readFile(invalidPath)).toEqual(original);
    expect(await readdir(directory)).toEqual(['enterprise-auth.json']);
  });
});
