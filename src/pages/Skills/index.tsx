/**
 * Skills Page
 * Browse and manage AI skills
 */
import { Suspense, lazy, useEffect, useRef, useState, useCallback } from 'react';
import { Search, Puzzle, Lock, Package, X, AlertCircle, Trash2, FolderOpen, Copy, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { isGatewayStopped } from '@/lib/gateway-status';
import { toast } from 'sonner';
import type { Skill } from '@/types/skill';
import type { GatewayStatus } from '@/types/gateway';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SkillFileSections } from '@/components/file-preview/SkillFileSections';
import { getFilePreviewTargetIdentity, type FilePreviewTarget } from '@/components/file-preview/types';
import type { SkillFile } from '@/lib/skill-files';

const FilePreviewOverlayLazy = lazy(() =>
  import('@/components/file-preview/FilePreviewOverlay'),
);

function skillFileToTarget(file: SkillFile): FilePreviewTarget {
  return {
    filePath: file.filePath,
    fileName: file.fileName,
    ext: file.ext,
    mimeType: file.mimeType,
    contentType: file.contentType,
  };
}

const INSTALL_ERROR_CODES = new Set(['installTimeoutError', 'installRateLimitError']);
const FETCH_ERROR_CODES = new Set(['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError']);
const SEARCH_ERROR_CODES = new Set(['searchTimeoutError', 'searchRateLimitError', 'timeoutError', 'rateLimitError']);

type SkillsGatewayBannerState = 'none' | 'stopped';

function getSkillsGatewayBannerState(status: GatewayStatus): SkillsGatewayBannerState {
  if (isGatewayStopped(status)) {
    return 'stopped';
  }
  return 'none';
}

// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onReturnFocus: () => void;
  onOpenFolder?: (skill: Skill) => Promise<void> | void;
}

function resolveSkillSourceLabel(skill: Skill, t: TFunction<'skills'>): string {
  const source = (skill.source || '').trim().toLowerCase();
  if (!source) {
    if (skill.isBundled) return t('source.badge.bundled', { defaultValue: 'Bundled dir' });
    return t('source.badge.unknown', { defaultValue: 'Unknown source' });
  }
  if (source === 'openclaw-bundled') return t('source.badge.bundled', { defaultValue: 'Bundled dir' });
  if (source === 'openclaw-managed') return t('source.badge.managed', { defaultValue: 'Managed' });
  if (source === 'openclaw-workspace') return t('source.badge.workspace', { defaultValue: 'Workspace' });
  if (source === 'openclaw-extra') return t('source.badge.extra', { defaultValue: 'Extra dirs' });
  if (source === 'openclaw-plugin') return t('source.badge.plugin', { defaultValue: 'Plugin dir' });
  if (source === 'agents-skills-personal')
    return t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' });
  if (source === 'agents-skills-project') return t('source.badge.agentsProject', { defaultValue: 'Project .agents' });
  return source;
}

function SkillDetailDialog({ skill, isOpen, onClose, onReturnFocus, onOpenFolder }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const [openedSkillFile, setOpenedSkillFile] = useState<FilePreviewTarget | null>(null);
  const [reading, setReading] = useState(false);
  const slidePositions = useRef<Record<string, number>>({});
  const [initialSlideIndex, setInitialSlideIndex] = useState(0);
  const fileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailMetaComponents = rendererExtensionRegistry.getSkillDetailMetaComponents();

  const handleCopyPath = async () => {
    if (!skill?.baseDir) return;
    try {
      await navigator.clipboard.writeText(skill.baseDir);
      toast.success(t('toast.copiedPath'));
    } catch (err) {
      toast.error(t('toast.failedCopyPath') + ': ' + String(err));
    }
  };

  if (!skill) return null;


  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}>
      <DialogContent
        data-testid="skill-detail-dialog"
        className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-modal p-0 shadow-2xl"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogTitle className="sr-only">{skill.name}</DialogTitle>
        <DialogClose asChild><Button variant="ghost" size="icon" className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full" aria-label={t('detail.close')}><X className="h-4 w-4" /></Button></DialogClose>
        <Suspense fallback={null}>
          <FilePreviewOverlayLazy file={openedSkillFile} open={isOpen && reading} onClose={() => setReading(false)}
            onReturnFocus={() => fileTriggerRef.current?.focus()}
            initialPptxSlideIndex={initialSlideIndex}
            onPptxSlideIndexChange={index => { if (openedSkillFile) slidePositions.current[getFilePreviewTargetIdentity(openedSkillFile)] = index; }}
          />
        </Suspense>
        {/* Scrollable Content */}
        <div data-testid="skill-detail-content" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col items-start mb-6">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-surface-modal border border-black/5 dark:border-white/5 shrink-0 mb-4 relative shadow-sm">
              <span className="text-2xl">{skill.icon || '🔧'}</span>
              {skill.isCore && (
                <div className="absolute -bottom-1 -right-1 bg-surface-modal rounded-full p-1 shadow-sm border border-black/5 dark:border-white/5">
                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              )}
            </div>
            <h2 className="mb-3 break-all pr-8 font-sans text-xl font-medium tracking-normal text-foreground">
              {skill.name}
            </h2>
            <div
              data-skill-detail-meta-row="1"
              className="flex items-center flex-wrap gap-2 mb-4 opacity-80"
            >
              {skill.version && (
                <Badge
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors"
                >
                  v{skill.version}
                </Badge>
              )}
              <Badge
                variant="secondary"
                className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors"
              >
                {skill.isCore ? t('detail.coreSystem') : resolveSkillSourceLabel(skill, t)}
              </Badge>
              {detailMetaComponents.map((DetailMetaComponent, index) => (
                <DetailMetaComponent key={`skill-detail-meta-${index}`} skill={skill} />
              ))}
            </div>

            {skill.description && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {skill.description}
              </p>
            )}
          </div>

          <div className="space-y-5 border-t border-black/10 dark:border-white/10 pt-4">
            <div className="space-y-2">
              <div data-testid="skill-detail-source" className="flex items-center gap-2 flex-wrap">
                <h3 className="text-meta font-bold text-foreground/80">{t('detail.source')}</h3>
                <Badge
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
                >
                  {resolveSkillSourceLabel(skill, t)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={skill.baseDir || t('detail.pathUnavailable')}
                  readOnly
                  className="h-[38px] font-mono text-xs bg-transparent border-black/10 dark:border-white/10 rounded-xl text-foreground/70"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={handleCopyPath}
                  title={t('detail.copyPath')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={() => onOpenFolder?.(skill)}
                  title={t('detail.openActualFolder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* File Sections — read-only preview of skill content */}
            {skill.baseDir && (
              <div className="space-y-3">
                <h3 className="text-meta font-bold text-foreground/80">
                  {t('detail.sections.title', { defaultValue: '内容' })}
                </h3>
                <SkillFileSections
                  baseDir={skill.baseDir}
                  onOpen={(file, trigger) => {
                    const target = skillFileToTarget(file);
                    fileTriggerRef.current = trigger;
                    setInitialSlideIndex(slidePositions.current[getFilePreviewTargetIdentity(target)] ?? 0);
                    setOpenedSkillFile(current => current && getFilePreviewTargetIdentity(current) === getFilePreviewTargetIdentity(target) ? current : target);
                    setReading(true);
                  }}
                />
              </div>
            )}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Skills() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    searching,
    searchError,
    installing,
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [searchQuery, setSearchQuery] = useState('');
  const [installQuery, setInstallQuery] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailVisit, setDetailVisit] = useState(0);
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [marketplaceAvailable, setMarketplaceAvailable] = useState(false);

  const gatewayRunning = gatewayStatus.state === 'running';
  const gatewayReportedReady = gatewayStatus.gatewayReady !== false;
  const gatewayRuntimeKey = `${gatewayStatus.pid ?? 'none'}:${gatewayStatus.connectedAt ?? 'none'}:${gatewayStatus.port}`;
  const gatewayBannerState = getSkillsGatewayBannerState(gatewayStatus);
  const [showGatewayBanner, setShowGatewayBanner] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gatewayBannerState === 'none') {
      timer = setTimeout(() => {
        setShowGatewayBanner(false);
      }, 0);
    } else {
      timer = setTimeout(() => {
        setShowGatewayBanner(true);
      }, 1500);
    }
    return () => clearTimeout(timer);
  }, [gatewayBannerState]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setInterval> | null = null;

    const attemptFetch = async () => {
      const ok = await fetchSkills();
      if (cancelled || !ok) return;
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
    };

    void attemptFetch();

    if (gatewayRunning && !gatewayReportedReady) {
      retryTimer = setInterval(() => {
        void attemptFetch();
      }, 5_000);
    }

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearInterval(retryTimer);
      }
    };
  }, [fetchSkills, gatewayReportedReady, gatewayRunning, gatewayRuntimeKey]);

  useEffect(() => {
    let cancelled = false;
    void hostApi.skills
      .clawhubCapability()
      .then((result) => {
        if (cancelled) return;
        setMarketplaceAvailable(
          Boolean(result.success && (result.capability?.canInstall || result.capability?.canSearch)),
        );
      })
      .catch(() => {
        if (!cancelled) setMarketplaceAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const safeSkills = Array.isArray(skills) ? skills : [];
  const enabledSkillsCount = safeSkills.filter((skill) => skill.enabled).length;
  const disabledSkillsCount = safeSkills.filter((skill) => !skill.enabled).length;
  const filteredSkills = safeSkills
    .filter((skill) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        q.length === 0 ||
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.id.toLowerCase().includes(q) ||
        (skill.slug || '').toLowerCase().includes(q) ||
        (skill.author || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'enabled' ? skill.enabled : !skill.enabled);
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (a.enabled && !b.enabled) return -1;
      if (!a.enabled && b.enabled) return 1;
      if (a.isCore && !b.isCore) return -1;
      if (!a.isCore && b.isCore) return 1;
      return a.name.localeCompare(b.name);
    });

  const handleToggle = useCallback(
    async (skillId: string, enable: boolean) => {
      try {
        if (enable) {
          await enableSkill(skillId);
          toast.success(t('toast.enabled'));
        } else {
          await disableSkill(skillId);
          toast.success(t('toast.disabled'));
        }
      } catch (err) {
        toast.error(String(err));
      }
    },
    [enableSkill, disableSkill, t],
  );



  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = await hostApi.openclaw.getSkillsDir();
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = await hostApi.shell.openPath(skillsDir);
      if (result) {
        if (
          result.toLowerCase().includes('no such file') ||
          result.toLowerCase().includes('not found') ||
          result.toLowerCase().includes('failed to open')
        ) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const handleOpenSkillFolder = useCallback(
    async (skill: Skill) => {
      try {
        const result = await hostApi.skills.clawhubOpenSkillPath({
          skillKey: skill.id,
          slug: skill.slug,
          baseDir: skill.baseDir,
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to open folder');
        }
      } catch (err) {
        toast.error(t('toast.failedOpenActualFolder') + ': ' + String(err));
      }
    },
    [t],
  );

  const [skillsDirPath, setSkillsDirPath] = useState('~/.openclaw/skills');

  useEffect(() => {
    hostApi.openclaw
      .getSkillsDir()
      .then((dir) => setSkillsDirPath(dir))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!discoverOpen || !marketplaceAvailable) {
      return;
    }

    const query = installQuery.trim();
    if (query.length === 0) {
      searchSkills('');
      return;
    }

    const timer = setTimeout(() => {
      searchSkills(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [installQuery, discoverOpen, marketplaceAvailable, searchSkills]);

  const handleInstall = useCallback(
    async (slug: string) => {
      try {
        await installSkill(slug);
        toast.success(t('toast.installed'));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (INSTALL_ERROR_CODES.has(errorMessage)) {
          toast.error(t(`toast.${errorMessage}`, { path: skillsDirPath }), { duration: 10000 });
        } else {
          toast.error(t('toast.failedInstall') + ': ' + errorMessage);
        }
      }
    },
    [installSkill, t, skillsDirPath],
  );
  const handleUninstall = useCallback(
    async (slug: string) => {
      try {
        await uninstallSkill(slug);
        toast.success(t('toast.uninstalled'));
      } catch (err) {
        toast.error(t('toast.failedUninstall') + ': ' + String(err));
      }
    },
    [uninstallSkill, t],
  );

  if (loading) {
    return (
      <div data-testid="skills-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100%+3rem)] overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-6 md:p-8">
          <h1 className="mb-6 font-sans text-2xl font-medium tracking-normal">{t('title')}</h1>
          <div className="flex flex-1 items-center justify-center"><LoadingSpinner size="lg" /></div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="skills-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100%+3rem)] overflow-hidden"
    >
      <Dialog open={discoverOpen && marketplaceAvailable} onOpenChange={setDiscoverOpen}>
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 md:p-8">
        <div className="mb-6 flex shrink-0 flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <h1 className="mb-1 font-sans text-2xl font-medium tracking-normal text-foreground">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 md:mt-2">
            <Button variant="outline" size="sm" onClick={handleOpenSkillsFolder}><FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />{t('openFolder')}</Button>
            {marketplaceAvailable && <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" aria-hidden="true" />{t('actions.installSkill')}</Button></DialogTrigger>}
          </div>
        </div>

        {/* Gateway Status Banner */}
        {showGatewayBanner && gatewayBannerState !== 'none' && (
          <div
            data-testid="skills-gateway-banner"
            data-state={gatewayBannerState}
            className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3"
          >
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">{t('gatewayWarning')}</span>
          </div>
        )}

        <div data-testid="skills-toolbar" className="mb-5 flex shrink-0 flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label={t('search')}
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 rounded-lg border-transparent bg-surface-input pl-9 pr-8 text-xs shadow-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label={t('actions.clearSearch')}
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
            {(['all', 'enabled', 'disabled'] as const).map((filter) => (
              <Button
                key={filter}
                type="button"
                variant="ghost"
                size="sm"
                data-testid={`skills-filter-${filter}`}
                aria-pressed={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
                className={cn(
                  'h-8 rounded-lg px-3 text-xs font-medium shadow-none',
                  statusFilter === filter
                    ? 'bg-black/5 dark:bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
                )}
              >
                {t(filter === 'all' ? 'filter.all' : filter === 'enabled' ? 'filter.enabledList' : 'filter.disabledList', {
                  count: filter === 'all' ? safeSkills.length : filter === 'enabled' ? enabledSkillsCount : disabledSkillsCount,
                })}
              </Button>
            ))}
            </div>
        </div>

        {/* Content Area */}
        <div data-testid="skills-list-scroll" className="flex-1 overflow-y-auto pr-2 min-h-0 -mr-2">
          {error && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{FETCH_ERROR_CODES.has(error) ? t(`toast.${error}`, { path: skillsDirPath }) : error}</span>
            </div>
          )}

          <div className={cn("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3", filteredSkills.length === 0 && "h-full")}>
            {filteredSkills.length === 0 ? (
              <div data-testid="skills-empty-state" className="col-span-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
              </div>
            ) : (
              filteredSkills.map((skill) => (
                <article key={skill.id} data-testid="skill-card" className="relative rounded-xl border border-border/70 bg-surface-modal p-4 transition-colors hover:border-foreground/20">
                  <button type="button" className="block w-full text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => {
                    detailTriggerRef.current = event.currentTarget;
                    setSelectedSkill(skill);
                    setDetailVisit(visit => visit + 1);
                    setDetailOpen(true);
                  }} aria-label={t('detail.open', { name: skill.name })}>
                    <div className="mb-3 flex items-center gap-2.5 pr-11">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/5 text-lg dark:bg-white/10">{skill.icon || '🧩'}</span>
                      <h3 className="truncate text-sm font-medium">{skill.name}</h3>
                      {skill.isCore && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </div>
                    <p className="min-h-10 line-clamp-2 text-sm leading-5 text-muted-foreground">{skill.description}</p>
                    <Badge data-testid="skill-source-badge" variant="secondary" className="mt-3 max-w-full bg-black/5 px-2 font-normal dark:bg-white/10">
                      <span className="truncate">{resolveSkillSourceLabel(skill, t)}</span>
                    </Badge>
                  </button>
                  <Switch className="absolute right-4 top-[22px] h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:shadow-sm [&>span[data-state=checked]]:translate-x-4" aria-label={t('actions.toggle', { name: skill.name })} checked={skill.enabled} onCheckedChange={(checked) => handleToggle(skill.id, checked)} disabled={skill.isCore} />
                </article>
              ))
            )}
          </div>
        </div>
      </div>

        <DialogContent data-testid="skills-discover" className="flex h-[min(680px,calc(100vh-3rem))] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-modal shadow-xl">
          <div className="relative shrink-0 px-6 pt-6">
            <DialogTitle className="pr-8 font-sans text-lg font-medium tracking-normal">
              {t('marketplace.installDialogTitle')}
            </DialogTitle>
            <DialogDescription className="mt-1 pr-8 text-sm text-muted-foreground">{t('marketplace.installDialogSubtitle')}</DialogDescription>
            <DialogClose asChild><Button variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8" aria-label={t('common:actions.close')}><X className="h-4 w-4" /></Button></DialogClose>
            <div className="mt-4 flex flex-col md:flex-row gap-2">
              <div className="relative flex items-center bg-black/5 dark:bg-white/5 rounded-xl px-3 py-2 border border-black/10 dark:border-white/10 flex-1">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  aria-label={t('searchMarketplace')}
                  placeholder={t('searchMarketplace')}
                  value={installQuery}
                  onChange={(e) => setInstallQuery(e.target.value)}
                  className="ml-2 h-auto border-0 bg-transparent p-0 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-meta"
                />
                {installQuery && (
                  <button
                    type="button"
                    aria-label={t('actions.clearSearch')}
                    onClick={() => setInstallQuery('')}
                    className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {searchError && (
              <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>
                  {SEARCH_ERROR_CODES.has(searchError.replace('Error: ', ''))
                    ? t(`toast.${searchError.replace('Error: ', '')}`, { path: skillsDirPath })
                    : searchError}
                </span>
              </div>
            )}

            {searching && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-sm">{t('marketplace.searching')}</p>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="flex flex-col gap-1">
                {searchResults.map((skill) => {
                  const isInstalled = safeSkills.some((s) => s.id === skill.slug || s.name === skill.name);
                  const isInstallLoading = !!installing[skill.slug];

                  return (
                    <div
                      key={skill.slug}
                      className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5 last:border-0"
                      onClick={() => hostApi.shell.openExternal(`https://clawhub.ai/s/${skill.slug}`)}
                    >
                      <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                        <div className="h-10 w-10 shrink-0 flex items-center justify-center text-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl overflow-hidden">
                          📦
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-semibold text-foreground truncate">{skill.name}</h3>
                            {skill.author && <span className="text-xs text-muted-foreground">• {skill.author}</span>}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                            {skill.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {skill.version && (
                          <span className="text-meta font-mono text-muted-foreground mr-2">v{skill.version}</span>
                        )}
                        {isInstalled ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleUninstall(skill.slug)}
                            disabled={isInstallLoading}
                            className="h-8 shadow-none"
                          >
                            {isInstallLoading ? <LoadingSpinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleInstall(skill.slug)}
                            disabled={isInstallLoading}
                            className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                          >
                            {isInstallLoading ? <LoadingSpinner size="sm" /> : t('marketplace.install', 'Install')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!searching && searchResults.length === 0 && !searchError && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Package className="h-10 w-10 mb-4 opacity-50" />
                <p>{installQuery.trim() ? t('marketplace.noResults') : t('marketplace.emptyPrompt')}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        key={`${selectedSkill?.id ?? ''}:${detailVisit}`}
        skill={selectedSkill}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onReturnFocus={() => detailTriggerRef.current?.focus()}
        onOpenFolder={handleOpenSkillFolder}
      />
    </div>
  );
}

export default Skills;
