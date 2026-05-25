import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClawHubService } from '@electron/gateway/clawhub';

describe('ClawHubService marketplace HTTP lookup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the official ClawHub search API before the CLI fallback', async () => {
    const service = new ClawHubService();
    const runCommand = vi.spyOn(service as unknown as { runCommand(args: string[]): Promise<string> }, 'runCommand');
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{
        slug: 'pdf',
        displayName: 'PDF Tools',
        summary: 'Read and transform PDFs',
        version: '1.2.3',
        score: 4.25,
      }],
    }), {
      headers: { 'content-type': 'application/json' },
    }));

    const result = await service.search({ query: 'pdf', limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.origin).toBe('https://clawhub.ai');
    expect(requestedUrl.pathname).toBe('/api/v1/search');
    expect(requestedUrl.searchParams.get('q')).toBe('pdf');
    expect(requestedUrl.searchParams.get('limit')).toBe('5');
    expect(runCommand).not.toHaveBeenCalled();
    expect(result).toEqual([{
      slug: 'pdf',
      name: 'PDF Tools',
      description: 'Read and transform PDFs',
      version: '1.2.3',
    }]);
  });

  it('uses the official ClawHub skills API for explore before the CLI fallback', async () => {
    const service = new ClawHubService();
    const runCommand = vi.spyOn(service as unknown as { runCommand(args: string[]): Promise<string> }, 'runCommand');
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{
        slug: 'writer',
        displayName: 'Writer',
        summary: 'Draft structured documents',
        latestVersion: { version: '2.0.0' },
      }],
    }), {
      headers: { 'content-type': 'application/json' },
    }));

    const result = await service.explore({ limit: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.origin).toBe('https://clawhub.ai');
    expect(requestedUrl.pathname).toBe('/api/v1/skills');
    expect(requestedUrl.searchParams.get('limit')).toBe('3');
    expect(runCommand).not.toHaveBeenCalled();
    expect(result).toEqual([{
      slug: 'writer',
      name: 'Writer',
      description: 'Draft structured documents',
      version: '2.0.0',
    }]);
  });

  it('falls back to the CLI when the HTTP marketplace response is not JSON', async () => {
    const service = new ClawHubService();
    const runCommand = vi
      .spyOn(service as unknown as { runCommand(args: string[]): Promise<string> }, 'runCommand')
      .mockResolvedValueOnce('pdf v1.0.0 PDF toolkit (3.500)');
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(new Response('<!doctype html><html></html>', {
      headers: { 'content-type': 'text/html' },
    }));

    const result = await service.search({ query: 'pdf', limit: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(['search', 'pdf', '--limit', '1']);
    expect(result).toEqual([{
      slug: 'pdf',
      name: 'pdf',
      description: 'PDF toolkit',
      version: '1.0.0',
    }]);
  });

  it('falls back to the CLI when the HTTP marketplace request fails', async () => {
    const service = new ClawHubService();
    const runCommand = vi
      .spyOn(service as unknown as { runCommand(args: string[]): Promise<string> }, 'runCommand')
      .mockResolvedValueOnce('pdf v1.0.0 PDF toolkit');
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await service.search({ query: 'pdf' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(['search', 'pdf']);
    expect(result[0]).toMatchObject({
      slug: 'pdf',
      description: 'PDF toolkit',
      version: '1.0.0',
    });
  });

  it('falls back to the CLI when the HTTP marketplace request is aborted', async () => {
    const service = new ClawHubService();
    const runCommand = vi
      .spyOn(service as unknown as { runCommand(args: string[]): Promise<string> }, 'runCommand')
      .mockResolvedValueOnce('pdf v1.0.0 PDF toolkit');
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

    const result = await service.search({ query: 'pdf' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(['search', 'pdf']);
    expect(result[0]).toMatchObject({
      slug: 'pdf',
      description: 'PDF toolkit',
      version: '1.0.0',
    });
  });

  it('falls back to the CLI when the HTTP marketplace returns a server error', async () => {
    const service = new ClawHubService();
    const runCommand = vi
      .spyOn(service as unknown as { runCommand(args: string[]): Promise<string> }, 'runCommand')
      .mockResolvedValueOnce('pdf v1.0.0 PDF toolkit');
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(new Response('temporary failure', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    }));

    const result = await service.search({ query: 'pdf' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(['search', 'pdf']);
    expect(result[0]).toMatchObject({
      slug: 'pdf',
      description: 'PDF toolkit',
      version: '1.0.0',
    });
  });
});
