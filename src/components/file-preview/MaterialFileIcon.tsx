import { useMemo } from 'react';
import { getIcon } from 'material-file-icons';
import { cn } from '@/lib/utils';

interface MaterialFileIconProps {
  filename: string;
  className?: string;
}

export function MaterialFileIcon({ filename, className }: MaterialFileIconProps) {
  const svg = useMemo(() => getIcon(filename || 'file').svg, [filename]);

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full', className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
