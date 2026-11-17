import { useEffect, useState } from 'react';
import { ArrowUpRight, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import { getQuickSkillSourceLabel } from '@/lib/skill-source-label';
import type { QuickAccessSkill } from '@/types/skill';
import type { FilePreviewTarget } from '@/components/file-preview/types';

export function AgentCapabilities({ workspace, onManageSkills, onOpenFile }: {
  workspace: string;
  onManageSkills: () => void;
  onOpenFile: (file: FilePreviewTarget, trigger: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation('agents');
  const { t: skillsT } = useTranslation('skills');
  const [result, setResult] = useState<{ workspace: string; skills: QuickAccessSkill[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- on-demand asynchronous workspace snapshot
    setLoading(true);
    setFailed(false);
    void fetchQuickAccessSkills({ workspace }, { preferCache: revision === 0 }).then(response => {
      if (cancelled) return;
      if (!response.success) throw new Error('unavailable');
      setResult({ workspace, skills: response.skills ?? [] });
    }).catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspace, revision]);
  const skills = result?.workspace === workspace ? result.skills : [];
  return <div className="space-y-8">
    <section className="space-y-3" aria-labelledby="agent-skills-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="agent-skills-title" className="text-base font-medium">{t('detailTabs.workspaceSkills')}</h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className="h-3.5 w-3.5" />{t('refresh')}</Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-primary" onClick={onManageSkills}>{t('detailTabs.manageSkills')}<ArrowUpRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{t('detailTabs.skillsScope')}</p>
      {loading ? <div className="flex justify-center py-8"><LoadingSpinner size="sm" /></div>
        : failed ? <p role="alert" className="py-4 text-sm text-muted-foreground">{t('detailTabs.skillsFailed')}</p>
          : skills.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t('detailTabs.skillsEmpty')}</p>
            : <div className="divide-y divide-border" data-testid="agent-workspace-skills">{skills.map(skill => (
              <button key={skill.manifestPath} type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5" onClick={event => onOpenFile({ filePath: skill.manifestPath, fileName: 'SKILL.md', ext: '.md', mimeType: 'text/markdown', contentType: 'document' }, event.currentTarget)}>
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{skill.name}</span><span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">{skill.description}</span></span>
                <Badge variant="secondary" className="max-w-[30%] shrink-0 truncate">{getQuickSkillSourceLabel(skill.source, skillsT)}</Badge>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}</div>}
    </section>
    <section className="space-y-3 border-t border-border pt-6">
      <h3 className="flex items-center gap-2 text-base font-medium"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{t('detailTabs.toolsAndSandbox')}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{t('detailTabs.permissionsScope')}</p>
    </section>
  </div>;
}
