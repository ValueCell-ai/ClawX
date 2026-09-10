export type AsrErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'RATE_LIMITED'
  | 'SERVER'
  | 'REQUEST'
  | 'NETWORK'
  | 'EMPTY_RESULT';

export class AsrClientError extends Error {
  constructor(readonly code: AsrErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AsrClientError';
  }
}

export const ASR_ERROR_MESSAGE_PREFIX = 'ASR';

export function serializeAsrError(error: AsrClientError): AsrClientError {
  return new AsrClientError(
    error.code,
    `${ASR_ERROR_MESSAGE_PREFIX}:${error.code}:${error.message}`,
  );
}

const ASR_ERROR_CODES: ReadonlySet<string> = new Set<AsrErrorCode>([
  'INVALID_INPUT',
  'NOT_CONFIGURED',
  'AUTH',
  'RATE_LIMITED',
  'SERVER',
  'REQUEST',
  'NETWORK',
  'EMPTY_RESULT',
]);

const ASR_ERROR_CODE_PATTERN = new RegExp(`^${ASR_ERROR_MESSAGE_PREFIX}:([A-Z_]+):`);

export function parseAsrErrorCode(message: string): AsrErrorCode | null {
  const match = ASR_ERROR_CODE_PATTERN.exec(message);
  if (!match) return null;
  const code = match[1];
  return ASR_ERROR_CODES.has(code) ? (code as AsrErrorCode) : null;
}
