import { type AnchorHTMLAttributes } from 'react';

export interface BrowserLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export function BrowserLink({
  children,
}: BrowserLinkProps) {
  return (
    <span className="break-words break-all">
      {children}
    </span>
  );
}

export default BrowserLink;
