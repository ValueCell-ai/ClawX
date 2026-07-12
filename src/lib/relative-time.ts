import { format, register } from 'timeago.js';
import zhCN from 'timeago.js/lib/lang/zh_CN';
import ja from 'timeago.js/lib/lang/ja';
import ru from 'timeago.js/lib/lang/ru';

let localesRegistered = false;

function ensureTimeagoLocalesRegistered() {
  if (localesRegistered) return;
  register('zh_CN', zhCN);
  register('ja', ja);
  register('ru', ru);
  localesRegistered = true;
}

export function getTimeagoLocale(language?: string): string {
  const normalized = (language || '').toLowerCase();
  if (normalized.startsWith('zh')) return 'zh_CN';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('ru')) return 'ru';
  return 'en_US';
}

export function formatSessionRelativeTime(timestampMs: number, nowMs: number, language?: string): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '';
  ensureTimeagoLocalesRegistered();
  const safeNowMs = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now();
  const safeTimestampMs = Math.min(timestampMs, safeNowMs);
  return format(safeTimestampMs, getTimeagoLocale(language), { relativeDate: safeNowMs });
}
