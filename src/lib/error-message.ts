import { AppError, normalizeAppError } from './error-model';

export { AppError } from './error-model';

export function toUserMessage(error: unknown): string {
  const appError = error instanceof AppError ? error : normalizeAppError(error);

  switch (appError.code) {
    case 'AUTH_INVALID':
      return 'Authentication failed. Check API key or login session and retry.';
    case 'TIMEOUT':
      return 'Request timed out. Please retry.';
    case 'RATE_LIMIT':
      return 'Too many requests. Please wait and try again.';
    case 'PERMISSION':
      return 'Permission denied. Check your configuration and retry.';
    case 'CHANNEL_UNAVAILABLE':
      return 'Service channel unavailable. Retry after restarting the app or gateway.';
    case 'NETWORK':
      return 'Network error. Please verify connectivity and retry.';
    case 'CONFIG':
      return 'Configuration is invalid. Please review settings.';
    case 'GATEWAY':
      return 'Gateway is unavailable. Start or restart the gateway and retry.';
    default:
      return appError.message || 'Unexpected error occurred.';
  }
}
