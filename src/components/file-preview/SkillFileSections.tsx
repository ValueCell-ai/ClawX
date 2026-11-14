/**
 * Skill detail dialog file sections.
 *
 * Loads `loadSkillFiles(baseDir)` and groups the result into
 * Docs / Scripts / Hooks / Assets cards (Other is hidden by default).
 */
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import {
  EMPTY_SKILL_GROUPS,
  isSkillFileGroupsEmpty,
  loadSkillFiles,
  type SkillFile,
  type SkillFileGroups,
} from '@/lib/skill-files';
import { FilePreviewIcon } from './file-card-utils';
import { formatFileSize } from './format';

export interface SkillFileSectionsProps {
  baseDir: string;
  onOpen: (file: SkillFile, trigger: HTMLButtonElement) => void;
  className?: string;
}

export function SkillFileSections({ baseDir, onOpen, className }: SkillFileSectionsProps) {
  const { t } = useTranslation('skills');
  const [groups, setGroups] = useState<SkillFileGroups>(EMPTY_SKILL_GROUPS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- async fetch with loading/error flags */
    if (!baseDir) {
      setGroups(EMPTY_SKILL_GROUPS);
      return;
    }
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    loadSkillFiles(baseDir)
      .then((next) => {
        if (cancelled) return;
        setGroups(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseDir]);

  if (!baseDir) return null;

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-6', className)}>
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive', className)}>
        {t('detail.sections.scanFailed', { defaultValue: 'Failed to scan skill directory' })}
      </div>
    );
  }

  if (isSkillFileGroupsEmpty(groups)) {
    return (
      <div className={cn('rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/5', className)}>
        {t('detail.sections.empty', { defaultValue: 'This skill does not contain any previewable files.' })}
      </div>
    );
  }

  const skillFile = groups.docs.find((file) => file.relativePath.replace(/\\/g, '/').toLowerCase() === 'skill.md');
  const documents = groups.docs.filter((file) => file !== skillFile);
  const sections = [
    { title: t('detail.sections.docs'), files: documents },
    { title: t('detail.sections.scripts'), files: groups.scripts },
    { title: t('detail.sections.hooks'), files: groups.hooks },
    { title: t('detail.sections.assets'), files: groups.assets },
    { title: t('detail.sections.other'), files: groups.others },
  ];
  return (
    <div className={className}>
      {skillFile && (
        <button type="button" onClick={(event) => onOpen(skillFile, event.currentTarget)}
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-modal p-3 text-left hover:bg-black/5 dark:hover:bg-white/5" title={skillFile.filePath}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FilePreviewIcon contentType={skillFile.contentType} mimeType={skillFile.mimeType} ext={skillFile.ext} className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{skillFile.fileName}</span><span className="text-xs text-muted-foreground">{formatFileSize(skillFile.size)}</span></span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
      <div className="mt-4">
        {sections.filter((section) => section.files.length > 0).map((section) => (
          <details key={section.title} className="group border-b border-border">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              {section.title}<span className="text-xs font-normal text-muted-foreground">{section.files.length}</span>
            </summary>
            <div className="space-y-1 pb-2">
              {section.files.map((file) => (
                <button key={file.filePath} type="button" onClick={(event) => onOpen(file, event.currentTarget)} title={file.filePath}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10">
                  <FilePreviewIcon contentType={file.contentType} mimeType={file.mimeType} ext={file.ext} className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs">{file.relativePath || file.fileName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export default SkillFileSections;
