import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'events';

const spawnMock = vi.fn();

vi.mock('electron', () => ({
    app: { isPackaged: false },
    shell: { openPath: vi.fn() },
}));

vi.mock('../../electron/utils/paths', () => ({
    getOpenClawConfigDir: () => '/tmp/test-openclaw',
    ensureDir: vi.fn(),
    getClawHubCliBinPath: () => '/tmp/test-bin/clawhub',
    getClawHubCliEntryPath: () => '/tmp/test-bin/clawhub.js',
    quoteForCmd: (s: string) => s,
}));

vi.mock('child_process', () => ({
    default: { spawn: (...args: unknown[]) => spawnMock(...args) },
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('fs', () => {
    const base = {
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        promises: { rm: vi.fn(), writeFile: vi.fn() },
    };
    return { default: base, ...base };
});

const fetchMock = vi.fn();
global.fetch = fetchMock;

function mockSpawnResult(stdout: string, code = 0) {
    spawnMock.mockImplementation(() => {
        const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => {
            child.stdout.emit('data', Buffer.from(stdout));
            child.stderr.emit('data', Buffer.from(''));
            child.emit('close', code);
        });
        return child;
    });
}

function jsonResponse(data: unknown, contentType = 'application/json') {
    return Promise.resolve({
        ok: true,
        headers: { get: (h: string) => h === 'content-type' ? contentType : null },
        json: () => Promise.resolve(data),
    });
}

describe('ClawHub HTTP-first search/explore fallback', () => {
    let ClawHubService: typeof import('../../electron/gateway/clawhub').ClawHubService;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        fetchMock.mockReset();
        const mod = await import('../../electron/gateway/clawhub');
        ClawHubService = mod.ClawHubService;
    });

    describe('search()', () => {
        it('returns HTTP results when the official API responds with valid JSON', async () => {
            fetchMock.mockReturnValueOnce(jsonResponse({
                results: [
                    { slug: 'test-skill', displayName: 'Test Skill', summary: 'A test', version: '1.0.0' },
                ],
            }));

            const service = new ClawHubService();
            const results = await service.search({ query: 'test' });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toContain('/api/search?q=test');
            expect(results).toEqual([{
                slug: 'test-skill',
                name: 'Test Skill',
                description: 'A test',
                version: '1.0.0',
            }]);
        });

        it('falls back to CLI when HTTP returns HTML (cn-mirror scenario)', async () => {
            fetchMock.mockReturnValueOnce(Promise.resolve({
                ok: true,
                headers: { get: (h: string) => h === 'content-type' ? 'text/html' : null },
                json: () => Promise.reject(new Error('not json')),
            }));

            mockSpawnResult('my-skill v1.0.0 A great skill');

            const service = new ClawHubService();
            const results = await service.search({ query: 'test' });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].slug).toBe('my-skill');
        });

        it('falls back to CLI on network error', async () => {
            fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            mockSpawnResult('my-skill v1.0.0 A great skill');

            const service = new ClawHubService();
            const results = await service.search({ query: 'test' });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].slug).toBe('my-skill');
        });

        it('falls back to CLI on 5xx response', async () => {
            fetchMock.mockReturnValueOnce(Promise.resolve({
                ok: false,
                status: 500,
                headers: { get: () => null },
            }));

            mockSpawnResult('my-skill v1.0.0 A great skill');

            const service = new ClawHubService();
            const results = await service.search({ query: 'test' });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].slug).toBe('my-skill');
        });
    });

    describe('explore()', () => {
        it('returns HTTP results when the official API responds with valid JSON', async () => {
            fetchMock.mockReturnValueOnce(jsonResponse({
                results: [
                    { slug: 'trending-skill', displayName: 'Trending', summary: 'Popular', version: '2.0.0' },
                ],
            }));

            const service = new ClawHubService();
            const results = await service.explore({ limit: 10 });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toContain('/api/explore?limit=10');
            expect(results).toEqual([{
                slug: 'trending-skill',
                name: 'Trending',
                description: 'Popular',
                version: '2.0.0',
            }]);
        });

        it('falls back to CLI when HTTP fails', async () => {
            fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            mockSpawnResult('cool-skill v1.0.0 2 hours ago A cool skill');

            const service = new ClawHubService();
            const results = await service.explore();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].slug).toBe('cool-skill');
        });
    });
});
