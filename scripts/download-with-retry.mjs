import { createHash } from 'node:crypto';

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 2000;

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function describeError(error) {
  return error?.cause?.message ?? error?.message ?? String(error);
}

async function downloadFromUrl(url, { fetchImpl, attempts, baseDelayMs, label, log }) {
  const chunks = [];
  let received = 0;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryable = true;
    try {
      const resuming = received > 0;
      const response = await fetchImpl(url, resuming ? { headers: { Range: `bytes=${received}-` } } : undefined);
      if (!response.ok) {
        retryable = isRetryableStatus(response.status);
        throw new Error(`Failed to download ${label}: ${response.status} ${response.statusText}`);
      }
      const rangeStart = /^bytes (\d+)-/.exec(response.headers?.get?.('content-range') ?? '')?.[1];
      if (resuming && (response.status !== 206 || Number(rangeStart) !== received)) {
        chunks.length = 0;
        received = 0;
      }
      if (response.body) {
        for await (const chunk of response.body) {
          chunks.push(Buffer.from(chunk));
          received += chunk.byteLength;
        }
      } else {
        const body = Buffer.from(await response.arrayBuffer());
        chunks.push(body);
        received += body.byteLength;
      }
      return Buffer.concat(chunks);
    } catch (error) {
      lastError = error;
      if (!retryable || attempt === attempts) break;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      const progress = received > 0 ? `, resuming at ${received} bytes` : '';
      log(`Download of ${label} from ${url} failed (attempt ${attempt}/${attempts}: ${describeError(error)}); retrying in ${delayMs / 1000}s${progress}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/**
 * Downloads a file into memory from the first source that delivers it.
 * A dropped connection resumes with an HTTP Range request when the server
 * supports it; 408, 429 and 5xx responses are retried with backoff. When
 * `sha256` is given, a mismatching body moves on to the next source.
 */
export async function downloadBufferWithRetry(source, options = {}) {
  const urls = Array.isArray(source) ? source : [source];
  const {
    fetchImpl = globalThis.fetch,
    attempts = DEFAULT_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    label = urls[0],
    sha256,
    log = (message) => console.warn(message),
  } = options;

  let lastError;
  for (const url of urls) {
    try {
      const buffer = await downloadFromUrl(url, { fetchImpl, attempts, baseDelayMs, label, log });
      if (sha256) {
        const actual = createHash('sha256').update(buffer).digest('hex');
        if (actual !== sha256) {
          throw new Error(`SHA256 mismatch for ${label} from ${url}: expected ${sha256}, received ${actual}`);
        }
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (url !== urls.at(-1)) log(`Giving up on ${url} for ${label} (${describeError(error)}); trying the next source`);
    }
  }
  throw lastError;
}
