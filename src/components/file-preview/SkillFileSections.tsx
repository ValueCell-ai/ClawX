/**
 * Skill detail dialog file sections.
 *
 * Loads `loadSkillFiles(baseDir)` and groups the result into
 * Docs / Scripts / Hooks / Assets cards (Other is hidden by default).
 */
import { useEffect, useState } from 'react';
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
  onOpen: (file: SkillFile) => void;
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

  return (
    <div className={cn('space-y-5', className)}>
      <SkillFileSection
        title={t('detail.sections.docs', { defaultValue: 'Docs' })}
        description={t('detail.sections.docsDesc', { defaultValue: 'SKILL.md and documentation' })}
        files={groups.docs}
        onOpen={onOpen}
      />
      <SkillFileSection
        title={t('detail.sections.scripts', { defaultValue: 'Scripts' })}
        description={t('detail.sections.scriptsDesc', { defaultValue: 'Executable scripts and commands' })}
        files={groups.scripts}
        onOpen={onOpen}
      />
      <SkillFileSection
        title={t('detail.sections.hooks', { defaultValue: 'Hooks' })}
        description={t('detail.sections.hooksDesc', { defaultValue: 'Hooks injected into the OpenClaw lifecycle' })}
        files={groups.hooks}
        onOpen={onOpen}
      />
      <SkillFileSection
        title={t('detail.sections.assets', { defaultValue: 'Assets' })}
        description={t('detail.sections.assetsDesc', { defaultValue: 'Templates, references, and static assets' })}
        files={groups.assets}
        onOpen={onOpen}
      />
    </div>
  );
}

interface SkillFileSectionProps {
  title: string;
  description: string;
  files: SkillFile[];
  onOpen: (file: SkillFile) => void;
}

function SkillFileSection({ title, description, files, onOpen }: SkillFileSectionProps) {
  if (!files.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-meta font-bold text-foreground/80">
          {title}
          <span className="ml-2 text-2xs font-medium text-muted-foreground">{files.length}</span>
        </h4>
        <p className="text-2xs text-muted-foreground/80 truncate">{description}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {files.map((file) => (
          <button
            key={file.filePath}
            type="button"
            onClick={() => onOpen(file)}
            className={cn(
              'flex items-center gap-2 rounded-xl border border-black/5 bg-surface-input px-3 py-2 text-left transition-colors',
              'hover:border-primary/40 hover:bg-primary/5',
              'dark:border-white/5 dark:hover:bg-white/10',
            )}
            title={file.filePath}
          >
            <FilePreviewIcon
              contentType={file.contentType}
              mimeType={file.mimeType}
              ext={file.ext}
              className="h-4 w-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-mono text-foreground">{file.relativePath || file.fileName}</p>
            </div>
            <span className="shrink-0 text-2xs text-muted-foreground">
              {formatFileSize(file.size) || file.ext.replace('.', '').toUpperCase() || ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default SkillFileSections;
