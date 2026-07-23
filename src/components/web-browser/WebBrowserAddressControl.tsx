/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WEB_BROWSER_INITIAL_URL, parseWebBrowserAddress } from '@shared/web-browser';
import type { WebBrowserAddressErrorCode } from '@shared/web-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface WebBrowserAddressControlProps {
  title: string;
  url: string;
  faviconUrl?: string | null;
  onNavigate: (url: string) => void | Promise<void>;
  onAddressError: (error: WebBrowserAddressErrorCode) => void;
}

export function getWebBrowserDisplayText(title: string, url: string): string {
  return title.trim() || url;
}

function getAddressDraft(url: string): string {
  return url === WEB_BROWSER_INITIAL_URL ? '' : url;
}

function getUrlOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'null') return parsed.origin;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

interface WebBrowserFaviconProps {
  url: string | null;
  fallbackUrl: string | null;
  onLoad: (url: string) => void;
}

function WebBrowserFavicon({
  url,
  fallbackUrl,
  onLoad,
}: WebBrowserFaviconProps): React.ReactElement {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const source = [url, fallbackUrl].find(
    (candidate): candidate is string => candidate !== null && !failedUrls.includes(candidate),
  );

  if (!source) {
    return (
      <Globe
        aria-hidden="true"
        data-testid="web-browser-favicon-placeholder"
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
    );
  }

  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      data-testid="web-browser-favicon"
      className="h-4 w-4 shrink-0"
      referrerPolicy="no-referrer"
      onLoad={() => onLoad(source)}
      onError={() => setFailedUrls((current) => [...current, source])}
    />
  );
}

export function WebBrowserAddressControl({
  title,
  url,
  faviconUrl,
  onNavigate,
  onAddressError,
}: WebBrowserAddressControlProps): React.ReactElement {
  const { t } = useTranslation('chat');
  const [editing, setEditing] = useState(url === WEB_BROWSER_INITIAL_URL);
  const [draft, setDraft] = useState(() => getAddressDraft(url));
  const [lastLoadedFavicon, setLastLoadedFavicon] = useState<{
    origin: string;
    url: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestSubmissionRef = useRef(0);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const cancelEditing = () => {
    setEditing(false);
  };

  const submit = () => {
    const result = parseWebBrowserAddress(draft);
    if (!result.ok) {
      onAddressError(result.reason);
      inputRef.current?.focus();
      return;
    }

    const submission = ++latestSubmissionRef.current;
    try {
      void Promise.resolve(onNavigate(result.url)).then(
        () => {
          if (latestSubmissionRef.current === submission) setEditing(false);
        },
        () => {
          if (latestSubmissionRef.current === submission) inputRef.current?.focus();
        },
      );
    } catch {
      if (latestSubmissionRef.current === submission) inputRef.current?.focus();
    }
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        data-testid="web-browser-address-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={cancelEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditing();
          }
        }}
        aria-label={t('artifactPanel.webBrowser.address.label')}
        placeholder={t('artifactPanel.webBrowser.address.placeholder')}
        className="h-8 min-w-0 flex-1 bg-surface-input px-2 text-xs"
      />
    );
  }

  const displayText = getWebBrowserDisplayText(title, url);
  const currentOrigin = getUrlOrigin(url);
  const fallbackFaviconUrl = faviconUrl
    && lastLoadedFavicon?.origin === currentOrigin
    && lastLoadedFavicon.url !== faviconUrl
    ? lastLoadedFavicon.url
    : null;
  return (
    <Button
      type="button"
      variant="ghost"
      data-testid="web-browser-address-display"
      onClick={() => {
        setDraft(getAddressDraft(url));
        setEditing(true);
      }}
      className="h-8 min-w-0 flex-1 justify-start gap-1.5 bg-surface-input px-2 text-left text-xs font-normal"
    >
      <WebBrowserFavicon
        key={`${faviconUrl ?? ''}|${fallbackFaviconUrl ?? ''}`}
        url={faviconUrl ?? null}
        fallbackUrl={fallbackFaviconUrl}
        onLoad={(loadedUrl) => {
          if (!currentOrigin) return;
          setLastLoadedFavicon({ origin: currentOrigin, url: loadedUrl });
        }}
      />
      <span aria-hidden="true" className="min-w-0 truncate">{displayText}</span>
      <span className="sr-only">{displayText}, {url}</span>
    </Button>
  );
}
