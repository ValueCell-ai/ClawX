import type { IncomingMessage, ServerResponse } from 'http';
import { PORTS } from '../utils/config';

/**
 * Allowed CORS origins — only the Electron renderer (Vite dev or production)
 * and the OpenClaw Gateway are permitted to make cross-origin requests.
 */
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORTS.CLAWX_DEV}`,
  `http://localhost:${PORTS.CLAWX_DEV}`,
  `http://127.0.0.1:${PORTS.OPENCLAW_GATEWAY}`,
  `http://localhost:${PORTS.OPENCLAW_GATEWAY}`,
]);

export async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

/**
 * Validate that mutation requests (POST/PUT/DELETE) carry a JSON Content-Type.
 * This prevents "simple request" CSRF where the browser skips the preflight
 * when Content-Type is text/plain or application/x-www-form-urlencoded.
 */
export function requireJsonContentType(req: IncomingMessage): boolean {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') {
    return true;
  }
  // Requests without a body (content-length 0 or absent) are safe — CSRF
  // "simple request" attacks rely on sending a crafted body.
  const contentLength = req.headers['content-length'];
  if (contentLength === '0' || contentLength === undefined) {
    return true;
  }
  const ct = req.headers['content-type'] || '';
  return ct.includes('application/json');
}

export function setCorsHeaders(res: ServerResponse, origin?: string): void {
  // Only reflect the Origin header back if it is in the allow-list.
  // Omitting the header for unknown origins causes the browser to block
  // the response — this is the intended behavior for untrusted callers.
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function sendNoContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

export function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}
