/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WEB_BROWSER_INITIAL_URL, parseWebBrowserAddress } from '@shared/web-browser';
import type { WebBrowserAddressErrorCode } from '@shared/web-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface WebBrowserAddressControlProps {
  title: string;
  url: string;
  onNavigate: (url: string) => void | Promise<void>;
  onAddressError: (error: WebBrowserAddressErrorCode) => void;
}

export function getWebBrowserDisplayText(title: string, url: string): string {
  return title.trim() || url;
}

function getAddressDraft(url: string): string {
  return url === WEB_BROWSER_INITIAL_URL ? '' : url;
}

export function WebBrowserAddressControl({
  title,
  url,
  onNavigate,
  onAddressError,
}: WebBrowserAddressControlProps): React.ReactElement {
  const { t } = useTranslation('chat');
  const [editing, setEditing] = useState(url === WEB_BROWSER_INITIAL_URL);
  const [draft, setDraft] = useState(() => getAddressDraft(url));
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
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-testid="web-browser-address-display"
          onClick={() => {
            setDraft(getAddressDraft(url));
            setEditing(true);
          }}
          className="h-8 min-w-0 flex-1 justify-start bg-surface-input px-2 text-left text-xs font-normal"
        >
          <span aria-hidden="true" className="min-w-0 truncate">{displayText}</span>
          <span className="sr-only">{displayText}, {url}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{url}</TooltipContent>
    </Tooltip>
  );
}
